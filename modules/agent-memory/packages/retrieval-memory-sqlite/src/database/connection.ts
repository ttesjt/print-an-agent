import { DatabaseSync } from 'node:sqlite';
import { load } from 'sqlite-vec';
import { initializeSchema } from './schema.js';
import type { SqliteDatabaseConfiguration } from './types.js';

export function openDatabase(config: SqliteDatabaseConfiguration): DatabaseSync {
  const db = new DatabaseSync(config.path, { allowExtension: true, timeout: config.busyTimeoutMs });
  try {
    load(db);
    db.enableLoadExtension(false);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    initializeSchema(db);
    return db;
  } catch (cause) {
    try {
      db.close();
    } catch (cleanup) {
      throw new AggregateError([cause, cleanup], 'SQLite initialization and cleanup failed.');
    }
    throw cause;
  }
}
