import { AgentConfigError } from '@print-an-agent/base-identity-config/config';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { runConfigTransaction } from './database.js';
import { createConfigStoreMigration } from './migrations/0001_create_config_store.js';
import { quoteSqliteIdentifier } from './table-names.js';
import type { SqliteAgentConfigTableNames } from './types/table-names.js';

const CONFIG_SCHEMA_COMPONENT = 'config';

const CURRENT_CONFIG_STORAGE_SCHEMA_VERSION = 1;

const SCHEMA_COLUMNS = Object.freeze(['component', 'version']);

const CONFIG_COLUMNS = Object.freeze(['agent_id', 'schema_version', 'revision', 'value_json']);

type SqliteRow = Record<string, SQLOutputValue>;

function readSchemaVersion(
  database: DatabaseSync,
  tableNames: SqliteAgentConfigTableNames
): number | undefined {
  let row: SqliteRow | undefined;
  try {
    row = database
      .prepare(
        `SELECT version FROM ${quoteSqliteIdentifier(tableNames.schema)} WHERE component = ?`
      )
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
    throw new AgentConfigError(
      'CONFIG_STORAGE_SCHEMA_INVALID',
      `SQLite Config table "${tableName}" does not match the expected schema.`
    );
  }
}

export function initializeConfigSchema(
  database: DatabaseSync,
  tableNames: SqliteAgentConfigTableNames
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${quoteSqliteIdentifier(tableNames.schema)} (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version >= 1)
    ) STRICT;
  `);
  const version = readSchemaVersion(database, tableNames);
  if (version === undefined) {
    runConfigTransaction(database, () => {
      database.exec(createConfigStoreMigration(tableNames));
      database
        .prepare(
          `INSERT INTO ${quoteSqliteIdentifier(tableNames.schema)} (component, version) VALUES (?, ?)`
        )
        .run(CONFIG_SCHEMA_COMPONENT, CURRENT_CONFIG_STORAGE_SCHEMA_VERSION);
    });
  }
  assertConfigSchema(database, tableNames);
}

export function assertConfigSchema(
  database: DatabaseSync,
  tableNames: SqliteAgentConfigTableNames
): void {
  const version = readSchemaVersion(database, tableNames);
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
  assertTableColumns(database, tableNames.schema, SCHEMA_COLUMNS);
  assertTableColumns(database, tableNames.configs, CONFIG_COLUMNS);
}

export function configureConfigDefensiveMode(database: DatabaseSync): void {
  database.enableDefensive(true);
}
