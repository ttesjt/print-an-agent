import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { AgentIdentityError } from '../../../types/errors.js';
import { runIdentityTransaction } from './database.js';
import { CREATE_IDENTITY_CATALOG_MIGRATION } from './migrations/0001_create_identity_catalog.js';

const IDENTITY_SCHEMA_COMPONENT = '@ta-agent/base-identity';
const CURRENT_IDENTITY_SCHEMA_VERSION = 1;
const EXPECTED_TABLE_COLUMNS = Object.freeze({
  ta_agent_base_identity_schema: Object.freeze(['component', 'version']),
  ta_agent_base_identities: Object.freeze([
    'agent_id',
    'display_name',
    'status',
    'revision',
    'created_at',
    'updated_at',
  ]),
});

type SqliteRow = Record<string, SQLOutputValue>;

function readSchemaVersion(database: DatabaseSync): number | undefined {
  let row: SqliteRow | undefined;
  try {
    row = database
      .prepare('SELECT version FROM ta_agent_base_identity_schema WHERE component = ?')
      .get(IDENTITY_SCHEMA_COMPONENT) as SqliteRow | undefined;
  } catch (cause: unknown) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_SCHEMA_INVALID',
      'SQLite Identity schema metadata is invalid.',
      { cause }
    );
  }
  if (row === undefined) return undefined;
  if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_SCHEMA_INVALID',
      'SQLite Identity schema version is invalid.'
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
    throw new AgentIdentityError(
      'AGENT_IDENTITY_SCHEMA_INVALID',
      `SQLite Identity table "${tableName}" does not match the expected schema.`
    );
  }
}

export function initializeIdentitySchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ta_agent_base_identity_schema (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version >= 1)
    ) STRICT;
  `);
  const version = readSchemaVersion(database);
  if (version === undefined) {
    runIdentityTransaction(database, () => {
      database.exec(CREATE_IDENTITY_CATALOG_MIGRATION);
      database
        .prepare('INSERT INTO ta_agent_base_identity_schema (component, version) VALUES (?, ?)')
        .run(IDENTITY_SCHEMA_COMPONENT, CURRENT_IDENTITY_SCHEMA_VERSION);
    });
  }
  assertIdentitySchema(database);
}

export function assertIdentitySchema(database: DatabaseSync): void {
  const version = readSchemaVersion(database);
  if (version === undefined) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_SCHEMA_INVALID',
      'SQLite Identity schema metadata is missing.'
    );
  }
  if (version > CURRENT_IDENTITY_SCHEMA_VERSION) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_SCHEMA_UNSUPPORTED',
      `SQLite Identity schema version ${version} is newer than supported version ${CURRENT_IDENTITY_SCHEMA_VERSION}.`
    );
  }
  if (version !== CURRENT_IDENTITY_SCHEMA_VERSION) {
    throw new AgentIdentityError(
      'AGENT_IDENTITY_SCHEMA_INVALID',
      `SQLite Identity schema version ${version} has no migration path.`
    );
  }
  assertTableColumns(database, 'ta_agent_base_identity_schema');
  assertTableColumns(database, 'ta_agent_base_identities');
}

export function configureIdentityDefensiveMode(database: DatabaseSync): void {
  database.enableDefensive(true);
}
