import {
  AgentIdentityError,
  defineAgentIdentity,
  defineAgentIdentitySnapshot,
  isAgentIdentityStatus,
  parseAgentId,
  type AgentId,
  type AgentIdentityCatalogPort,
  type AgentIdentitySnapshot,
  type CreateAgentIdentityRequest,
  type TransitionAgentIdentityRequest,
  type RenameAgentIdentityRequest,
} from '@ta-agent/base-identity';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import {
  defineIdentityDatabaseConfiguration,
  readIdentityClock,
  runIdentityTransaction,
  useIdentityDatabase,
  type IdentityDatabaseConfiguration,
} from './database.js';
import {
  assertIdentitySchema,
  configureIdentityDefensiveMode,
  initializeIdentitySchema,
} from './schema.js';
import {
  quoteSqliteIdentifier,
  resolveSqliteAgentIdentityTableNames,
  type SqliteAgentIdentityTableNames,
  type SqliteAgentIdentityTableNamingInput,
} from './table-names.js';

export interface SqliteAgentIdentityCatalogAdapterOptions extends SqliteAgentIdentityTableNamingInput {
  readonly databasePath: string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
}

type SqliteRow = Record<string, SQLOutputValue>;

function requireRowString(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
      `SQLite Identity column "${column}" must be a string.`
    );
  }
  return value;
}

function decodeSnapshot(row: SqliteRow): AgentIdentitySnapshot {
  return defineAgentIdentitySnapshot({
    identity: {
      id: requireRowString(row, 'agent_id'),
      displayName: requireRowString(row, 'display_name'),
    },
    status: requireRowString(row, 'status'),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SqliteAgentIdentityCatalogAdapter implements AgentIdentityCatalogPort {
  readonly #configuration: IdentityDatabaseConfiguration;
  readonly #clock: () => number;
  readonly #tableNames: SqliteAgentIdentityTableNames;
  readonly #selectIdentity: string;

  constructor(options: SqliteAgentIdentityCatalogAdapterOptions) {
    this.#tableNames = resolveSqliteAgentIdentityTableNames(options);
    this.#selectIdentity = `SELECT agent_id, display_name, status, revision, created_at, updated_at
      FROM ${quoteSqliteIdentifier(this.#tableNames.identities)}`;
    this.#configuration = defineIdentityDatabaseConfiguration(
      options.databasePath,
      options.busyTimeoutMilliseconds
    );
    this.#clock = options.clock ?? Date.now;
    useIdentityDatabase(this.#configuration, 'initialize schema', (database) => {
      initializeIdentitySchema(database, this.#tableNames);
      configureIdentityDefensiveMode(database);
    });
  }

  create(request: CreateAgentIdentityRequest): Promise<AgentIdentitySnapshot> {
    return Promise.resolve().then(() => {
      const agentId = parseAgentId(request.identity.id);
      const timestamp = readIdentityClock(this.#clock);
      return this.#useDatabase('create identity', (database) =>
        runIdentityTransaction(database, () => {
          try {
            database
              .prepare(
                `INSERT INTO ${quoteSqliteIdentifier(this.#tableNames.identities)}
                   (agent_id, display_name, status, revision, created_at, updated_at)
                 VALUES (?, ?, 'active', 1, ?, ?)`
              )
              .run(agentId, request.identity.displayName, timestamp, timestamp);
          } catch (cause: unknown) {
            if (this.#select(database, agentId) !== undefined) {
              throw new AgentIdentityError(
                'AGENT_IDENTITY_ALREADY_EXISTS',
                `Agent Identity "${agentId}" already exists.`,
                { cause }
              );
            }
            throw cause;
          }
          return decodeSnapshot(this.#requireRow(database, agentId));
        })
      );
    });
  }

  read(agentIdInput: AgentId): Promise<AgentIdentitySnapshot | undefined> {
    return Promise.resolve().then(() => {
      const agentId = parseAgentId(agentIdInput);
      return this.#useDatabase('read identity', (database) => {
        const row = this.#select(database, agentId);
        return row === undefined ? undefined : decodeSnapshot(row);
      });
    });
  }

  list(): Promise<readonly AgentIdentitySnapshot[]> {
    return Promise.resolve().then(() =>
      this.#useDatabase('list identities', (database) =>
        Object.freeze(
          (
            database.prepare(`${this.#selectIdentity} ORDER BY agent_id ASC`).all() as SqliteRow[]
          ).map(decodeSnapshot)
        )
      )
    );
  }

  rename(request: RenameAgentIdentityRequest): Promise<AgentIdentitySnapshot> {
    return Promise.resolve().then(() => {
      const identity = defineAgentIdentity({
        id: request.agentId,
        displayName: request.displayName,
      });
      return this.#useDatabase('rename identity', (database) =>
        runIdentityTransaction(database, () => {
          const row = this.#select(database, identity.id);
          if (row === undefined) {
            throw new AgentIdentityError(
              'AGENT_IDENTITY_NOT_FOUND',
              'Agent Identity does not exist.'
            );
          }
          if (decodeSnapshot(row).revision !== request.expectedRevision) {
            throw new AgentIdentityError(
              'AGENT_IDENTITY_REVISION_CONFLICT',
              'Identity revision changed.'
            );
          }
          const result = database
            .prepare(
              `UPDATE ${quoteSqliteIdentifier(this.#tableNames.identities)}
           SET display_name = ?, revision = revision + 1, updated_at = ?
           WHERE agent_id = ? AND revision = ?`
            )
            .run(
              identity.displayName,
              readIdentityClock(this.#clock),
              identity.id,
              request.expectedRevision
            );
          if (result.changes !== 1) {
            throw new AgentIdentityError(
              'AGENT_IDENTITY_REVISION_CONFLICT',
              'Identity revision changed.'
            );
          }
          return decodeSnapshot(this.#requireRow(database, identity.id));
        })
      );
    });
  }

  transition(request: TransitionAgentIdentityRequest): Promise<AgentIdentitySnapshot> {
    return Promise.resolve().then(() => {
      const agentId = parseAgentId(request.agentId);
      if (!isAgentIdentityStatus(request.status)) {
        throw new AgentIdentityError(
          'AGENT_IDENTITY_STATUS_TRANSITION_INVALID',
          'Agent Identity lifecycle target is invalid.'
        );
      }
      const updatedAt = readIdentityClock(this.#clock);
      return this.#useDatabase('transition identity', (database) =>
        runIdentityTransaction(database, () => {
          const currentRow = this.#select(database, agentId);
          if (currentRow === undefined) {
            throw new AgentIdentityError(
              'AGENT_IDENTITY_NOT_FOUND',
              `Agent Identity "${agentId}" does not exist.`
            );
          }
          const current = decodeSnapshot(currentRow);
          if (current.revision !== request.expectedRevision) {
            throw new AgentIdentityError(
              'AGENT_IDENTITY_REVISION_CONFLICT',
              `Expected Agent Identity revision ${request.expectedRevision} but found ${current.revision}.`
            );
          }
          if (current.status === request.status) {
            throw new AgentIdentityError(
              'AGENT_IDENTITY_STATUS_TRANSITION_INVALID',
              `Agent Identity "${agentId}" is already ${request.status}.`
            );
          }
          const result = database
            .prepare(
              `UPDATE ${quoteSqliteIdentifier(this.#tableNames.identities)}
               SET status = ?, revision = revision + 1, updated_at = ?
               WHERE agent_id = ? AND revision = ? AND status = ?`
            )
            .run(request.status, updatedAt, agentId, request.expectedRevision, current.status);
          if (result.changes !== 1) {
            throw new AgentIdentityError(
              'AGENT_IDENTITY_REVISION_CONFLICT',
              'Agent Identity changed before the lifecycle transition committed.'
            );
          }
          return decodeSnapshot(this.#requireRow(database, agentId));
        })
      );
    });
  }

  #select(database: DatabaseSync, agentId: AgentId): SqliteRow | undefined {
    return database.prepare(`${this.#selectIdentity} WHERE agent_id = ?`).get(agentId) as
      | SqliteRow
      | undefined;
  }

  #requireRow(database: DatabaseSync, agentId: AgentId): SqliteRow {
    const row = this.#select(database, agentId);
    if (row === undefined) {
      throw new AgentIdentityError(
        'AGENT_IDENTITY_STORAGE_FAILED',
        `Agent Identity "${agentId}" disappeared during a committed operation.`
      );
    }
    return row;
  }

  #useDatabase<T>(operation: string, action: (database: DatabaseSync) => T): T {
    return useIdentityDatabase(this.#configuration, operation, (database) => {
      assertIdentitySchema(database, this.#tableNames);
      configureIdentityDefensiveMode(database);
      return action(database);
    });
  }
}
