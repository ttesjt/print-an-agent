import { DatabaseSync } from 'node:sqlite';

import type { ProfileId } from '@print-an-agent/workbench-domain';

import { SqlitePersistenceError, WorkbenchPersistenceError } from '../../errors.js';
import type { ProfilePersistence } from '../../ports/profile-persistence-adapter.js';
import { createRecordBackedPersistence } from '../../record-store/create-record-backed-persistence.js';
import { createSqlitePersistenceRecordStore } from './sqlite-persistence-record-store.js';
import { migrateSqlitePersistence } from './sqlite-migrations.js';

const DEFAULT_BUSY_TIMEOUT_MILLISECONDS = 5_000;

export interface SqlitePersistenceOptions {
  readonly databasePath: string;
  readonly profileId: ProfileId;
  readonly busyTimeoutMilliseconds?: number;
}

export interface SqlitePersistence extends ProfilePersistence {
  close(): void;
}

export function createSqlitePersistence(options: SqlitePersistenceOptions): SqlitePersistence {
  if (typeof options.databasePath !== 'string' || options.databasePath.length === 0) {
    throw new SqlitePersistenceError('The SQLite database path must not be empty.');
  }
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(options.databasePath);
  } catch (cause) {
    throw new SqlitePersistenceError(
      `Could not open the SQLite database at "${options.databasePath}".`,
      { cause }
    );
  }
  let closed = false;
  try {
    configureDatabase(database, options.busyTimeoutMilliseconds);
    migrateSqlitePersistence(database);
    const persistence = createRecordBackedPersistence(
      createSqlitePersistenceRecordStore(database, options.profileId),
      { profileId: options.profileId }
    );
    return Object.freeze({
      ...persistence,
      close: (): void => {
        if (closed) return;
        closed = true;
        database.close();
      },
    });
  } catch (cause) {
    if (!closed) database.close();
    if (cause instanceof WorkbenchPersistenceError) throw cause;
    throw new SqlitePersistenceError('Could not initialize SQLite persistence.', { cause });
  }
}

function configureDatabase(database: DatabaseSync, busyTimeoutMilliseconds?: number): void {
  const timeout = busyTimeoutMilliseconds ?? DEFAULT_BUSY_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeout) || timeout < 0) {
    throw new SqlitePersistenceError(
      'busyTimeoutMilliseconds must be a non-negative safe integer.'
    );
  }
  database.exec(`PRAGMA busy_timeout = ${String(timeout)}`);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = FULL');
}
