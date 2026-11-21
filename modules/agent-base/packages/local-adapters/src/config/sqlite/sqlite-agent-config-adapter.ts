import {
  AgentConfigError,
  type AgentConfigReadAdapter,
  type AgentConfigSnapshot,
  type AgentConfigWriteAdapter,
  type AgentConfigWriteRequest,
} from '@print-an-agent/base-identity-config/config';
import { parseAgentId, type AgentId } from '@print-an-agent/base-identity-config/identity';
import type { DatabaseSync } from 'node:sqlite';
import {
  defineConfigDatabaseConfiguration,
  runConfigTransaction,
  useConfigDatabase,
} from './database.js';
import {
  assertConfigSchema,
  configureConfigDefensiveMode,
  initializeConfigSchema,
} from './schema.js';
import { quoteSqliteIdentifier, resolveSqliteAgentConfigTableNames } from './table-names.js';
import type { ConfigDatabaseConfiguration } from './types/database.js';
import type { SqliteAgentConfigAdapterOptions } from './types/options.js';
import type { SqliteRow } from './types/record.js';
import type { SqliteAgentConfigTableNames } from './types/table-names.js';
import { decodeSnapshot, encodeValue } from './value-codec.js';
import { validateMaxValueBytes } from './value-limits.js';

export class SqliteAgentConfigAdapter implements AgentConfigReadAdapter, AgentConfigWriteAdapter {
  readonly #configuration: ConfigDatabaseConfiguration;
  readonly #maxValueBytes: number;
  readonly #tableNames: SqliteAgentConfigTableNames;
  readonly #selectConfig: string;

  constructor(options: SqliteAgentConfigAdapterOptions) {
    this.#tableNames = resolveSqliteAgentConfigTableNames(options);
    this.#selectConfig = `SELECT agent_id, schema_version, revision, value_json
      FROM ${quoteSqliteIdentifier(this.#tableNames.configs)}`;
    this.#configuration = defineConfigDatabaseConfiguration(
      options.databasePath,
      options.busyTimeoutMilliseconds
    );
    this.#maxValueBytes = validateMaxValueBytes(options.maxValueBytes);
    useConfigDatabase(this.#configuration, 'initialize schema', (database) => {
      initializeConfigSchema(database, this.#tableNames);
      configureConfigDefensiveMode(database);
    });
  }

  read(agentIdInput: AgentId): Promise<AgentConfigSnapshot | undefined> {
    return Promise.resolve().then(() => {
      const agentId = parseAgentId(agentIdInput);
      return this.#useDatabase('read config', (database) => {
        const row = this.#select(database, agentId);
        return row === undefined ? undefined : decodeSnapshot(row, this.#maxValueBytes);
      });
    });
  }

  write(request: AgentConfigWriteRequest): Promise<AgentConfigSnapshot> {
    return Promise.resolve().then(() => {
      const agentId = parseAgentId(request.agentId);
      if (!Number.isSafeInteger(request.schemaVersion) || request.schemaVersion < 1) {
        throw new AgentConfigError(
          'CONFIG_SCHEMA_VERSION_INVALID',
          'Config schemaVersion must be a positive safe integer.'
        );
      }
      const encoded = encodeValue(request.value, this.#maxValueBytes);
      return this.#useDatabase('write config', (database) =>
        runConfigTransaction(database, () => {
          const currentRow = this.#select(database, agentId);
          const currentRevision =
            currentRow === undefined
              ? null
              : decodeSnapshot(currentRow, this.#maxValueBytes).revision;
          if (currentRevision !== request.expectedRevision) {
            throw new AgentConfigError(
              'CONFIG_REVISION_CONFLICT',
              `Expected config revision ${String(request.expectedRevision)} but found ${String(currentRevision)}.`
            );
          }
          const nextRevision = (currentRevision ?? 0) + 1;
          if (currentRow === undefined) {
            database
              .prepare(
                `INSERT INTO ${quoteSqliteIdentifier(this.#tableNames.configs)}
                   (agent_id, schema_version, revision, value_json)
                 VALUES (?, ?, ?, ?)`
              )
              .run(agentId, request.schemaVersion, nextRevision, encoded);
          } else {
            const result = database
              .prepare(
                `UPDATE ${quoteSqliteIdentifier(this.#tableNames.configs)}
                 SET schema_version = ?, revision = ?, value_json = ?
                 WHERE agent_id = ? AND revision = ?`
              )
              .run(request.schemaVersion, nextRevision, encoded, agentId, currentRevision);
            if (result.changes !== 1) {
              throw new AgentConfigError(
                'CONFIG_REVISION_CONFLICT',
                'Agent config changed before the write committed.'
              );
            }
          }
          const committed = this.#select(database, agentId);
          if (committed === undefined) {
            throw new AgentConfigError(
              'CONFIG_STORAGE_FAILED',
              'Agent config disappeared during a committed write.'
            );
          }
          return decodeSnapshot(committed, this.#maxValueBytes);
        })
      );
    });
  }

  #select(database: DatabaseSync, agentId: AgentId): SqliteRow | undefined {
    return database.prepare(`${this.#selectConfig} WHERE agent_id = ?`).get(agentId) as
      | SqliteRow
      | undefined;
  }

  #useDatabase<T>(operation: string, action: (database: DatabaseSync) => T): T {
    return useConfigDatabase(this.#configuration, operation, (database) => {
      assertConfigSchema(database, this.#tableNames);
      configureConfigDefensiveMode(database);
      return action(database);
    });
  }
}
