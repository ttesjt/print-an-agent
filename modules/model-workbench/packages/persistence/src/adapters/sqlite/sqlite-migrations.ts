import type { DatabaseSync } from 'node:sqlite';

import { SqlitePersistenceError } from '../../errors.js';

const CURRENT_SCHEMA_VERSION = 1;

const CREATE_MIGRATION_TABLE = `
  CREATE TABLE IF NOT EXISTS workbench_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
`;

const CREATE_DYNAMIC_RECORD_TABLES = `
  CREATE TABLE IF NOT EXISTS workbench_runs (
    profile_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, run_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workbench_bases (
    profile_id TEXT NOT NULL,
    base_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, base_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workbench_modifications (
    profile_id TEXT NOT NULL,
    modification_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, modification_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workbench_outputs (
    profile_id TEXT NOT NULL,
    output_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, output_id)
  ) STRICT;
`;

export function migrateSqlitePersistence(database: DatabaseSync): void {
  database.exec(CREATE_MIGRATION_TABLE);
  database.exec('BEGIN IMMEDIATE');
  try {
    const version = readSchemaVersion(database);
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new SqlitePersistenceError(
        `SQLite schema version ${String(version)} is newer than supported version ${String(CURRENT_SCHEMA_VERSION)}.`
      );
    }
    if (version < 1) {
      database.exec(CREATE_DYNAMIC_RECORD_TABLES);
      database
        .prepare(
          `INSERT INTO workbench_schema_migrations (version, name, applied_at)
           VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
        )
        .run(1, 'create_dynamic_model_records');
    }
    database.exec('COMMIT');
  } catch (cause) {
    rollback(database);
    if (cause instanceof SqlitePersistenceError) throw cause;
    throw new SqlitePersistenceError('Failed to migrate the SQLite persistence schema.', { cause });
  }
}

function readSchemaVersion(database: DatabaseSync): number {
  const row: unknown = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS schema_version FROM workbench_schema_migrations')
    .get();
  const version =
    typeof row === 'object' && row !== null && Object.hasOwn(row, 'schema_version')
      ? (row as Readonly<Record<string, unknown>>).schema_version
      : undefined;
  if (typeof version !== 'number') {
    throw new SqlitePersistenceError('Could not read the SQLite persistence schema version.');
  }
  return version;
}

function rollback(database: DatabaseSync): void {
  try {
    database.exec('ROLLBACK');
  } catch {
    // Preserve the migration failure that triggered rollback.
  }
}
