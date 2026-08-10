import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { AgentConfigError } from '../../types/errors.js';
import { runConfigTransaction } from './database.js';
import { CREATE_CONFIG_STORE_MIGRATION } from './migrations/0001_create_config_store.js';

const CONFIG_SCHEMA_COMPONENT = '@ta-agent/base-config';
const CURRENT_CONFIG_STORAGE_SCHEMA_VERSION = 1;
const EXPECTED_TABLE_COLUMNS = Object.freeze({
  ta_agent_base_config_schema: Object.freeze(['component', 'version']),
  ta_agent_base_configs: Object.freeze(['agent_id', 'schema_version', 'revision', 'value_json']),
});

type SqliteRow = Record<string, SQLOutputValue>;

function readSchemaVersion(database: DatabaseSync): number | undefined {
  let row: SqliteRow | undefined;
  try {
    row = database
      .prepare('SELECT version FROM ta_agent_base_config_schema WHERE component = ?')
      .get(CONFIG_SCHEMA_COMPONENT) as SqliteRow | undefined;
  } catch (cause: unknown) {
    throw new AgentConfigError(
      'CONFIG_STORAGE_SCHEMA_INVALID',
      'SQLite Config schema metadata is invalid.',
      { cause }
    );
  }
  if (row === undefined) return undefined;
  if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new AgentConfigError(
      'CONFIG_STORAGE_SCHEMA_INVALID',
      'SQLite Config schema version is invalid.'
    );
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
    throw new AgentConfigError(
      'CONFIG_STORAGE_SCHEMA_INVALID',
      `SQLite Config table "${tableName}" does not match the expected schema.`
    );
  }
}

export function initializeConfigSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ta_agent_base_config_schema (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version >= 1)
    ) STRICT;
  `);
  const version = readSchemaVersion(database);
  if (version === undefined) {
    runConfigTransaction(database, () => {
      database.exec(CREATE_CONFIG_STORE_MIGRATION);
      database
        .prepare('INSERT INTO ta_agent_base_config_schema (component, version) VALUES (?, ?)')
        .run(CONFIG_SCHEMA_COMPONENT, CURRENT_CONFIG_STORAGE_SCHEMA_VERSION);
    });
  }
  assertConfigSchema(database);
}

export function assertConfigSchema(database: DatabaseSync): void {
  const version = readSchemaVersion(database);
  if (version === undefined) {
    throw new AgentConfigError(
      'CONFIG_STORAGE_SCHEMA_INVALID',
      'SQLite Config schema metadata is missing.'
    );
  }
  if (version > CURRENT_CONFIG_STORAGE_SCHEMA_VERSION) {
    throw new AgentConfigError(
      'CONFIG_STORAGE_SCHEMA_UNSUPPORTED',
      `SQLite Config schema version ${version} is newer than supported version ${CURRENT_CONFIG_STORAGE_SCHEMA_VERSION}.`
    );
  }
  if (version !== CURRENT_CONFIG_STORAGE_SCHEMA_VERSION) {
    throw new AgentConfigError(
      'CONFIG_STORAGE_SCHEMA_INVALID',
      `SQLite Config schema version ${version} has no migration path.`
    );
  }
  assertTableColumns(database, 'ta_agent_base_config_schema');
  assertTableColumns(database, 'ta_agent_base_configs');
}

export function configureConfigDefensiveMode(database: DatabaseSync): void {
  database.enableDefensive(true);
}
