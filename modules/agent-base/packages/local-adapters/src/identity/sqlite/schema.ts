import { AgentIdentityError } from '@print-an-agent/base-identity-config/identity';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { runIdentityTransaction } from './database.js';
import { createIdentityCatalogMigration } from './migrations/0001_create_identity_catalog.js';
import { quoteSqliteIdentifier } from './table-names.js';
import type { SqliteAgentIdentityTableNames } from './types/table-names.js';

const IDENTITY_SCHEMA_COMPONENT = 'identity';

const CURRENT_IDENTITY_SCHEMA_VERSION = 1;

const SCHEMA_COLUMNS = Object.freeze(['component', 'version']);

const IDENTITY_COLUMNS = Object.freeze([
  'agent_id',
  'display_name',
  'status',
  'revision',
  'created_at',
  'updated_at',
]);

type SqliteRow = Record<string, SQLOutputValue>;

function readSchemaVersion(
  database: DatabaseSync,
  tableNames: SqliteAgentIdentityTableNames
): number | undefined {
  let row: SqliteRow | undefined;
  try {
    row = database
      .prepare(
        `SELECT version FROM ${quoteSqliteIdentifier(tableNames.schema)} WHERE component = ?`
      )
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
    throw new AgentIdentityError(
      'AGENT_IDENTITY_SCHEMA_INVALID',
      `SQLite Identity table "${tableName}" does not match the expected schema.`
    );
  }
}

export function initializeIdentitySchema(
  database: DatabaseSync,
  tableNames: SqliteAgentIdentityTableNames
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${quoteSqliteIdentifier(tableNames.schema)} (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version >= 1)
    ) STRICT;
  `);
  const version = readSchemaVersion(database, tableNames);
  if (version === undefined) {
    runIdentityTransaction(database, () => {
      database.exec(createIdentityCatalogMigration(tableNames));
      database
        .prepare(
          `INSERT INTO ${quoteSqliteIdentifier(tableNames.schema)} (component, version) VALUES (?, ?)`
        )
        .run(IDENTITY_SCHEMA_COMPONENT, CURRENT_IDENTITY_SCHEMA_VERSION);
    });
  }
  assertIdentitySchema(database, tableNames);
}

export function assertIdentitySchema(
  database: DatabaseSync,
  tableNames: SqliteAgentIdentityTableNames
): void {
  const version = readSchemaVersion(database, tableNames);
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
  assertTableColumns(database, tableNames.schema, SCHEMA_COLUMNS);
  assertTableColumns(database, tableNames.identities, IDENTITY_COLUMNS);
}

export function configureIdentityDefensiveMode(database: DatabaseSync): void {
  database.enableDefensive(true);
}
