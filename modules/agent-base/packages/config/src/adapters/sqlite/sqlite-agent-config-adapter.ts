import { parseAgentId, type AgentId } from '@ta-agent/base-identity';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { normalizeConfigValue } from '../../lib/config-value.js';
import type {
  AgentConfigReadAdapter,
  AgentConfigWriteAdapter,
  AgentConfigWriteRequest,
} from '../../types/adapter.js';
import type { AgentConfigSnapshot, ConfigValue } from '../../types/config.js';
import { AgentConfigError } from '../../types/errors.js';
import {
  defineConfigDatabaseConfiguration,
  runConfigTransaction,
  useConfigDatabase,
  type ConfigDatabaseConfiguration,
} from './database.js';
import {
  assertConfigSchema,
  configureConfigDefensiveMode,
  initializeConfigSchema,
} from './schema.js';

const DEFAULT_MAX_VALUE_BYTES = 1_048_576;
const MAX_VALUE_BYTES_LIMIT = 16_777_216;

export interface SqliteAgentConfigAdapterOptions {
  readonly databasePath: string;
  readonly busyTimeoutMilliseconds?: number;
  readonly maxValueBytes?: number;
}

type SqliteRow = Record<string, SQLOutputValue>;

function validateMaxValueBytes(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_VALUE_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_VALUE_BYTES_LIMIT) {
    throw new AgentConfigError(
      'CONFIG_CONFIGURATION_INVALID',
      `SQLite Config maxValueBytes must be between 1 and ${MAX_VALUE_BYTES_LIMIT}.`
    );
  }
  return limit;
}

function requirePositiveInteger(row: SqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new AgentConfigError(
      'CONFIG_ADAPTER_RESULT_INVALID',
      `SQLite Config column "${column}" must be a positive safe integer.`
    );
  }
  return value;
}

function requireString(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new AgentConfigError(
      'CONFIG_ADAPTER_RESULT_INVALID',
      `SQLite Config column "${column}" must be a string.`
    );
  }
  return value;
}

function encodeValue(value: ConfigValue, maxValueBytes: number): string {
  const encoded = JSON.stringify(normalizeConfigValue(value));
  if (Buffer.byteLength(encoded, 'utf8') > maxValueBytes) {
    throw new AgentConfigError(
      'CONFIG_SIZE_LIMIT_EXCEEDED',
      `Encoded Agent config exceeds the ${maxValueBytes}-byte storage limit.`
    );
  }
  return encoded;
}

function decodeSnapshot(row: SqliteRow, maxValueBytes: number): AgentConfigSnapshot {
  const encoded = requireString(row, 'value_json');
  if (Buffer.byteLength(encoded, 'utf8') > maxValueBytes) {
    throw new AgentConfigError(
      'CONFIG_SIZE_LIMIT_EXCEEDED',
      `Stored Agent config exceeds the ${maxValueBytes}-byte storage limit.`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(encoded) as unknown;
  } catch (cause: unknown) {
    throw new AgentConfigError(
      'CONFIG_ADAPTER_RESULT_INVALID',
      'Stored Agent config is not JSON.',
      {
        cause,
      }
    );
  }
  return Object.freeze({
    agentId: parseAgentId(requireString(row, 'agent_id')),
    schemaVersion: requirePositiveInteger(row, 'schema_version'),
    revision: requirePositiveInteger(row, 'revision'),
    value: normalizeConfigValue(value),
  });
}

const SELECT_CONFIG = `SELECT agent_id, schema_version, revision, value_json
  FROM ta_agent_base_configs`;

export class SqliteAgentConfigAdapter implements AgentConfigReadAdapter, AgentConfigWriteAdapter {
  readonly #configuration: ConfigDatabaseConfiguration;
  readonly #maxValueBytes: number;

  constructor(options: SqliteAgentConfigAdapterOptions) {
    this.#configuration = defineConfigDatabaseConfiguration(
      options.databasePath,
      options.busyTimeoutMilliseconds
    );
    this.#maxValueBytes = validateMaxValueBytes(options.maxValueBytes);
    useConfigDatabase(this.#configuration, 'initialize schema', (database) => {
      initializeConfigSchema(database);
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
                `INSERT INTO ta_agent_base_configs
                   (agent_id, schema_version, revision, value_json)
                 VALUES (?, ?, ?, ?)`
              )
              .run(agentId, request.schemaVersion, nextRevision, encoded);
          } else {
            const result = database
              .prepare(
                `UPDATE ta_agent_base_configs
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
    return database.prepare(`${SELECT_CONFIG} WHERE agent_id = ?`).get(agentId) as
      | SqliteRow
      | undefined;
  }

  #useDatabase<T>(operation: string, action: (database: DatabaseSync) => T): T {
    return useConfigDatabase(this.#configuration, operation, (database) => {
      assertConfigSchema(database);
      configureConfigDefensiveMode(database);
      return action(database);
    });
  }
}
