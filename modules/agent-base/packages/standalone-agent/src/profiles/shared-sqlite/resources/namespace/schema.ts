import { DatabaseSync } from 'node:sqlite';
import { type SqliteManagedNamespaceTableNames } from '../../types/namespace-tables.js';
import { quoteSqliteIdentifier } from '../table-names.js';
import { storageError } from './errors.js';
import { runTransaction } from './transaction.js';
import type { SqliteRow } from './types.js';

const SCHEMA_COMPONENT = 'managed_namespace';

const CURRENT_SCHEMA_VERSION = 1;

const SCHEMA_COLUMNS = Object.freeze(['component', 'version']);

const NAMESPACE_COLUMNS = Object.freeze(['agent_id', 'state']);

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

export function assertSchema(
  database: DatabaseSync,
  tableNames: SqliteManagedNamespaceTableNames
): void {
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

export function initializeSchema(
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
