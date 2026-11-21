import type { DatabaseSync } from 'node:sqlite';
import { runImmediateTransaction } from '../database.js';
import { quoteSqliteIdentifier } from '../table-names.js';
import type { SqliteSessionTableNames } from '../types/table-names.js';
import { createSessionStoreMigration } from './migrations/0001_create_session_store.js';
import { addSessionCompactionMigration } from './migrations/0002_add_session_compaction.js';
import { addSessionNavigationMigration } from './migrations/0003_add_session_navigation.js';
import { addSessionMetadataMigration } from './migrations/0004_add_session_metadata.js';
import { sessionMemoryMigration } from './migrations/0005_add_session_memory_records.js';
import { assertSessionSchema } from './validation.js';
import {
  assertKnownSchemaVersion,
  CURRENT_SESSION_SCHEMA_VERSION,
  readSchemaVersion,
  SESSION_SCHEMA_COMPONENT,
} from './version.js';

export function initializeSessionSchema(
  database: DatabaseSync,
  tableNames: SqliteSessionTableNames
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${quoteSqliteIdentifier(tableNames.schema)} (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version >= 0)
    ) STRICT;
  `);

  const version = readSchemaVersion(database, tableNames);
  if (version === undefined) {
    runImmediateTransaction(database, () => {
      database.exec(createSessionStoreMigration(tableNames));
      database.exec(addSessionCompactionMigration(tableNames));
      database.exec(addSessionNavigationMigration(tableNames));
      database.exec(addSessionMetadataMigration(tableNames));
      database.exec(sessionMemoryMigration(tableNames));
      database
        .prepare(
          `INSERT INTO ${quoteSqliteIdentifier(tableNames.schema)} (component, version) VALUES (?, ?)`
        )
        .run(SESSION_SCHEMA_COMPONENT, CURRENT_SESSION_SCHEMA_VERSION);
    });
  } else if (version === 4) {
    runImmediateTransaction(database, () => {
      database.exec(sessionMemoryMigration(tableNames));
      database
        .prepare(
          `UPDATE ${quoteSqliteIdentifier(tableNames.schema)} SET version = ? WHERE component = ?`
        )
        .run(CURRENT_SESSION_SCHEMA_VERSION, SESSION_SCHEMA_COMPONENT);
    });
  } else {
    assertKnownSchemaVersion(version);
  }
  assertSessionSchema(database, tableNames);
}
