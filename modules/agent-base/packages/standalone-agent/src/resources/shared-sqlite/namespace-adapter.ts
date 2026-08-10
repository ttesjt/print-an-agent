import { lstatSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { parseAgentId, type AgentId } from '@ta-agent/base-identity';
import { AgentBaseStandaloneError } from '../../errors.js';
import type {
  AgentResourceNamespaceAdapter,
  StagedAgentResourceNamespace,
} from '../../managed-agent/contracts.js';
import type { SharedSqliteAgentResourceNamespace } from './types.js';

const SCHEMA_COMPONENT = '@ta-agent/base-standalone-agent:managed-namespace';
const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_BUSY_TIMEOUT_MILLISECONDS = 5_000;
const MAX_BUSY_TIMEOUT_MILLISECONDS = 2_147_483_647;
const EXPECTED_TABLE_COLUMNS = Object.freeze({
  ta_agent_base_managed_namespace_schema: Object.freeze(['component', 'version']),
  ta_agent_base_managed_namespaces: Object.freeze(['agent_id', 'state']),
});

type SqliteRow = Record<string, SQLOutputValue>;
type NamespaceState = 'pending' | 'published';

interface SharedSqliteConfiguration {
  readonly databasePath: string;
  readonly busyTimeoutMilliseconds: number;
}

function storageError(message: string, cause?: unknown): AgentBaseStandaloneError {
  return new AgentBaseStandaloneError(message, {
    code: 'STANDALONE_AGENT_STORAGE_INVALID',
    ...(cause === undefined ? {} : { cause }),
  });
}

function normalizeBusyTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_BUSY_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_BUSY_TIMEOUT_MILLISECONDS) {
    throw storageError(
      `Shared SQLite busy timeout must be between 1 and ${MAX_BUSY_TIMEOUT_MILLISECONDS} milliseconds.`
    );
  }
  return timeout;
}

function normalizeDatabasePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value === ':memory:' ||
    !isAbsolute(value)
  ) {
    throw storageError('Shared SQLite requires an explicit absolute file path.');
  }
  const databasePath = resolve(value);
  mkdirSync(dirname(databasePath), { recursive: true });
  try {
    const metadata = lstatSync(databasePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw storageError(
        'Shared SQLite path must name a regular file and cannot be a symbolic link.'
      );
    }
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
      return databasePath;
    }
    throw storageError('Shared SQLite path could not be inspected.', cause);
  }
  return databasePath;
}

function runTransaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const value = action();
    database.exec('COMMIT');
    return value;
  } catch (cause: unknown) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackCause: unknown) {
      throw new AggregateError(
        [cause, rollbackCause],
        'Shared SQLite namespace transaction and rollback both failed.'
      );
    }
    throw cause;
  }
}

function readSchemaVersion(database: DatabaseSync): number | undefined {
  let row: SqliteRow | undefined;
  try {
    row = database
      .prepare('SELECT version FROM ta_agent_base_managed_namespace_schema WHERE component = ?')
      .get(SCHEMA_COMPONENT) as SqliteRow | undefined;
  } catch (cause: unknown) {
    throw storageError('Shared SQLite namespace schema metadata is invalid.', cause);
  }
  if (row === undefined) return undefined;
  if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version)) {
    throw storageError('Shared SQLite namespace schema version is invalid.');
  }
  return row.version;
}

function assertTableColumns(
  database: DatabaseSync,
  tableName: keyof typeof EXPECTED_TABLE_COLUMNS
): void {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as SqliteRow[];
  const actual = rows.map((row) => row.name);
  const expected = EXPECTED_TABLE_COLUMNS[tableName];
  if (
    actual.length !== expected.length ||
    actual.some((column, index) => column !== expected[index])
  ) {
    throw storageError(`Shared SQLite namespace table "${tableName}" is invalid.`);
  }
}

function assertSchema(database: DatabaseSync): void {
  const version = readSchemaVersion(database);
  if (version === undefined) {
    throw storageError('Shared SQLite namespace schema metadata is missing.');
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw storageError('Shared SQLite namespace schema version is newer than supported.');
  }
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw storageError('Shared SQLite namespace schema version has no migration path.');
  }
  assertTableColumns(database, 'ta_agent_base_managed_namespace_schema');
  assertTableColumns(database, 'ta_agent_base_managed_namespaces');
}

function initializeSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ta_agent_base_managed_namespace_schema (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version >= 1)
    ) STRICT;
  `);
  if (readSchemaVersion(database) === undefined) {
    runTransaction(database, () => {
      database.exec(`
        CREATE TABLE ta_agent_base_managed_namespaces (
          agent_id TEXT PRIMARY KEY,
          state TEXT NOT NULL CHECK (state IN ('pending', 'published'))
        ) STRICT;
      `);
      database
        .prepare(
          'INSERT INTO ta_agent_base_managed_namespace_schema (component, version) VALUES (?, ?)'
        )
        .run(SCHEMA_COMPONENT, CURRENT_SCHEMA_VERSION);
    });
  }
  assertSchema(database);
}

function useDatabase<T>(
  configuration: SharedSqliteConfiguration,
  operation: string,
  action: (database: DatabaseSync) => T
): T {
  let database: DatabaseSync | undefined;
  let outcome:
    | Readonly<{ status: 'success'; value: T }>
    | Readonly<{ status: 'failure'; error: unknown }>;
  try {
    database = new DatabaseSync(configuration.databasePath, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
    });
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = ${configuration.busyTimeoutMilliseconds};
    `);
    assertSchema(database);
    database.enableDefensive(true);
    outcome = { status: 'success', value: action(database) };
  } catch (cause: unknown) {
    outcome = { status: 'failure', error: cause };
  }

  let closeError: AgentBaseStandaloneError | undefined;
  try {
    if (database?.isOpen === true) database.close();
  } catch (cause: unknown) {
    closeError = new AgentBaseStandaloneError(
      `Closing shared SQLite namespace operation "${operation}" failed.`,
      { code: 'STANDALONE_AGENT_STORAGE_FAILED', cause }
    );
  }
  if (outcome.status === 'failure') {
    const operationError =
      outcome.error instanceof AgentBaseStandaloneError
        ? outcome.error
        : new AgentBaseStandaloneError(`Shared SQLite namespace operation "${operation}" failed.`, {
            code: 'STANDALONE_AGENT_STORAGE_FAILED',
            cause: outcome.error,
          });
    if (closeError !== undefined) {
      throw new AggregateError(
        [operationError, closeError],
        `Shared SQLite namespace operation "${operation}" and cleanup both failed.`
      );
    }
    throw operationError;
  }
  if (closeError !== undefined) throw closeError;
  return outcome.value;
}

function readState(database: DatabaseSync, agentId: AgentId): NamespaceState | undefined {
  const row = database
    .prepare('SELECT state FROM ta_agent_base_managed_namespaces WHERE agent_id = ?')
    .get(agentId) as SqliteRow | undefined;
  if (row === undefined) return undefined;
  if (row.state !== 'pending' && row.state !== 'published') {
    throw storageError('Shared SQLite namespace contains an invalid publication state.');
  }
  return row.state;
}

export function createSharedSqliteAgentResourceNamespaceAdapter(
  options: Readonly<{
    databasePath: string;
    busyTimeoutMilliseconds?: number;
  }>
): AgentResourceNamespaceAdapter<SharedSqliteAgentResourceNamespace> {
  const configuration: SharedSqliteConfiguration = Object.freeze({
    databasePath: normalizeDatabasePath(options.databasePath),
    busyTimeoutMilliseconds: normalizeBusyTimeout(options.busyTimeoutMilliseconds),
  });
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(configuration.databasePath, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
    });
    database.exec(`PRAGMA busy_timeout = ${configuration.busyTimeoutMilliseconds};`);
    initializeSchema(database);
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    throw new AgentBaseStandaloneError('Shared SQLite namespace could not be initialized.', {
      code: 'STANDALONE_AGENT_STORAGE_FAILED',
      cause,
    });
  } finally {
    if (database?.isOpen === true) database.close();
  }
  const handle = Object.freeze({ databasePath: configuration.databasePath });

  return Object.freeze({
    stage: (agentIdInput: AgentId) => {
      const agentId = parseAgentId(agentIdInput);
      const resumed = useDatabase(configuration, 'stage Agent', (connection) =>
        runTransaction(connection, () => {
          const state = readState(connection, agentId);
          if (state === 'published') {
            throw new AgentBaseStandaloneError('Managed Standalone Agent already exists.', {
              code: 'STANDALONE_AGENT_ALREADY_EXISTS',
            });
          }
          if (state === 'pending') return true;
          connection
            .prepare('INSERT INTO ta_agent_base_managed_namespaces (agent_id, state) VALUES (?, ?)')
            .run(agentId, 'pending');
          return false;
        })
      );
      return Promise.resolve(Object.freeze({ agentId, resumed, handle }));
    },
    publish: (staged: StagedAgentResourceNamespace<SharedSqliteAgentResourceNamespace>) => {
      useDatabase(configuration, 'publish Agent', (connection) =>
        runTransaction(connection, () => {
          if (readState(connection, staged.agentId) !== 'pending') {
            throw storageError('Shared SQLite Agent namespace is not pending publication.');
          }
          const result = connection
            .prepare(
              'UPDATE ta_agent_base_managed_namespaces SET state = ? WHERE agent_id = ? AND state = ?'
            )
            .run('published', staged.agentId, 'pending');
          if (result.changes !== 1) {
            throw storageError('Shared SQLite Agent namespace publication lost ownership.');
          }
        })
      );
      return Promise.resolve(Object.freeze({ agentId: staged.agentId, handle }));
    },
    abort: () => Promise.resolve(),
    resolve: (agentIdInput: AgentId) => {
      const agentId = parseAgentId(agentIdInput);
      const published = useDatabase(
        configuration,
        'resolve Agent',
        (connection) => readState(connection, agentId) === 'published'
      );
      return Promise.resolve(published ? Object.freeze({ agentId, handle }) : undefined);
    },
    list: () => {
      const namespaces = useDatabase(configuration, 'list Agents', (connection) => {
        const rows = connection
          .prepare(
            'SELECT agent_id FROM ta_agent_base_managed_namespaces WHERE state = ? ORDER BY agent_id ASC'
          )
          .all('published') as SqliteRow[];
        return rows.map((row) => {
          if (typeof row.agent_id !== 'string') {
            throw storageError('Shared SQLite namespace Agent ID is invalid.');
          }
          return Object.freeze({ agentId: parseAgentId(row.agent_id), handle });
        });
      });
      return Promise.resolve(Object.freeze(namespaces));
    },
  });
}
