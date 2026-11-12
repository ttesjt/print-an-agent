import { lstatSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import {
  ManagedAgentNamespaceError,
  type ManagedAgentNamespacePort,
  type StagedManagedAgentNamespace,
} from '@print-an-agent/base-composition';
import { parseAgentId, type AgentId } from '@print-an-agent/base-identity';
import { AgentBaseStandaloneError } from '../../errors.js';
import type { SharedSqliteAgentResourceNamespace } from './types.js';
import {
  quoteSqliteIdentifier,
  resolveSqliteManagedNamespaceTableNames,
  type SqliteManagedNamespaceTableNames,
  type SqliteManagedNamespaceTableNamingInput,
} from './table-names.js';

const SCHEMA_COMPONENT = 'managed_namespace';
const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_BUSY_TIMEOUT_MILLISECONDS = 5_000;
const MAX_BUSY_TIMEOUT_MILLISECONDS = 2_147_483_647;
const SCHEMA_COLUMNS = Object.freeze(['component', 'version']);
const NAMESPACE_COLUMNS = Object.freeze(['agent_id', 'state']);

type SqliteRow = Record<string, SQLOutputValue>;
type NamespaceState = 'pending' | 'published';

interface SharedSqliteConfiguration {
  readonly databasePath: string;
  readonly busyTimeoutMilliseconds: number;
  readonly tableNames: SqliteManagedNamespaceTableNames;
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

function readSchemaVersion(
  database: DatabaseSync,
  tableNames: SqliteManagedNamespaceTableNames
): number | undefined {
  let row: SqliteRow | undefined;
  try {
    row = database
      .prepare(
        `SELECT version FROM ${quoteSqliteIdentifier(tableNames.schema)} WHERE component = ?`
      )
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
  tableName: string,
  expected: readonly string[]
): void {
  const rows = database
    .prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`)
    .all() as SqliteRow[];
  const actual = rows.map((row) => row.name);
  if (
    actual.length !== expected.length ||
    actual.some((column, index) => column !== expected[index])
  ) {
    throw storageError(`Shared SQLite namespace table "${tableName}" is invalid.`);
  }
}

function assertSchema(database: DatabaseSync, tableNames: SqliteManagedNamespaceTableNames): void {
  const version = readSchemaVersion(database, tableNames);
  if (version === undefined) {
    throw storageError('Shared SQLite namespace schema metadata is missing.');
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw storageError('Shared SQLite namespace schema version is newer than supported.');
  }
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw storageError('Shared SQLite namespace schema version has no migration path.');
  }
  assertTableColumns(database, tableNames.schema, SCHEMA_COLUMNS);
  assertTableColumns(database, tableNames.namespaces, NAMESPACE_COLUMNS);
}

function initializeSchema(
  database: DatabaseSync,
  tableNames: SqliteManagedNamespaceTableNames
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${quoteSqliteIdentifier(tableNames.schema)} (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version >= 1)
    ) STRICT;
  `);
  if (readSchemaVersion(database, tableNames) === undefined) {
    runTransaction(database, () => {
      database.exec(`
        CREATE TABLE ${quoteSqliteIdentifier(tableNames.namespaces)} (
          agent_id TEXT PRIMARY KEY,
          state TEXT NOT NULL CHECK (state IN ('pending', 'published'))
        ) STRICT;
      `);
      database
        .prepare(
          `INSERT INTO ${quoteSqliteIdentifier(tableNames.schema)} (component, version) VALUES (?, ?)`
        )
        .run(SCHEMA_COMPONENT, CURRENT_SCHEMA_VERSION);
    });
  }
  assertSchema(database, tableNames);
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
    assertSchema(database, configuration.tableNames);
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
      outcome.error instanceof AgentBaseStandaloneError ||
      outcome.error instanceof ManagedAgentNamespaceError
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

function readState(
  database: DatabaseSync,
  agentId: AgentId,
  tableNames: SqliteManagedNamespaceTableNames
): NamespaceState | undefined {
  const row = database
    .prepare(`SELECT state FROM ${quoteSqliteIdentifier(tableNames.namespaces)} WHERE agent_id = ?`)
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
  }> &
    SqliteManagedNamespaceTableNamingInput
): ManagedAgentNamespacePort<SharedSqliteAgentResourceNamespace> {
  const tableNames = resolveSqliteManagedNamespaceTableNames(options);
  const configuration: SharedSqliteConfiguration = Object.freeze({
    databasePath: normalizeDatabasePath(options.databasePath),
    busyTimeoutMilliseconds: normalizeBusyTimeout(options.busyTimeoutMilliseconds),
    tableNames,
  });
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(configuration.databasePath, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
    });
    database.exec(`PRAGMA busy_timeout = ${configuration.busyTimeoutMilliseconds};`);
    initializeSchema(database, tableNames);
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
          const state = readState(connection, agentId, tableNames);
          if (state === 'published') {
            throw new ManagedAgentNamespaceError(
              'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS',
              'Managed Agent namespace already exists.'
            );
          }
          if (state === 'pending') return true;
          connection
            .prepare(
              `INSERT INTO ${quoteSqliteIdentifier(tableNames.namespaces)} (agent_id, state) VALUES (?, ?)`
            )
            .run(agentId, 'pending');
          return false;
        })
      );
      return Promise.resolve(Object.freeze({ agentId, phase: 'staged' as const, resumed, handle }));
    },
    publish: (staged: StagedManagedAgentNamespace<SharedSqliteAgentResourceNamespace>) => {
      useDatabase(configuration, 'publish Agent', (connection) =>
        runTransaction(connection, () => {
          if (readState(connection, staged.agentId, tableNames) !== 'pending') {
            throw storageError('Shared SQLite Agent namespace is not pending publication.');
          }
          const result = connection
            .prepare(
              `UPDATE ${quoteSqliteIdentifier(tableNames.namespaces)} SET state = ? WHERE agent_id = ? AND state = ?`
            )
            .run('published', staged.agentId, 'pending');
          if (result.changes !== 1) {
            throw storageError('Shared SQLite Agent namespace publication lost ownership.');
          }
        })
      );
      return Promise.resolve(
        Object.freeze({ agentId: staged.agentId, phase: 'published' as const, handle })
      );
    },
    abort: () => Promise.resolve(),
    resolve: (agentIdInput: AgentId) => {
      const agentId = parseAgentId(agentIdInput);
      const published = useDatabase(
        configuration,
        'resolve Agent',
        (connection) => readState(connection, agentId, tableNames) === 'published'
      );
      return Promise.resolve(
        published ? Object.freeze({ agentId, phase: 'published' as const, handle }) : undefined
      );
    },
    list: () => {
      const namespaces = useDatabase(configuration, 'list Agents', (connection) => {
        const rows = connection
          .prepare(
            `SELECT agent_id FROM ${quoteSqliteIdentifier(tableNames.namespaces)} WHERE state = ? ORDER BY agent_id ASC`
          )
          .all('published') as SqliteRow[];
        return rows.map((row) => {
          if (typeof row.agent_id !== 'string') {
            throw storageError('Shared SQLite namespace Agent ID is invalid.');
          }
          return Object.freeze({
            agentId: parseAgentId(row.agent_id),
            phase: 'published' as const,
            handle,
          });
        });
      });
      return Promise.resolve(Object.freeze(namespaces));
    },
  });
}
