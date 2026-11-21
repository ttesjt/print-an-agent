import { DatabaseSync } from 'node:sqlite';

export function runTransaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const value = action();
    database.exec('COMMIT');
    return value;
  } catch (cause: unknown) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackCause: unknown) {
      throw new AggregateError(
        [cause, rollbackCause],
        'Shared SQLite namespace transaction and rollback both failed.'
      );
    }
    throw cause;
  }
}
