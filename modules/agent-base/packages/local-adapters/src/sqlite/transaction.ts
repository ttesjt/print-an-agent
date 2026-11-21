import type { DatabaseSync } from 'node:sqlite';
import type { SqliteTransactionOptions } from './types.js';

/** Joining is an explicit domain decision; BEGIN failure never rolls back another owner's work. */
export function runSqliteTransaction<T>(
  database: DatabaseSync,
  action: () => T,
  options: SqliteTransactionOptions
): T {
  if (options.existing === 'join' && database.isTransaction) return action();
  database.exec(options.begin);
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (cause: unknown) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackCause: unknown) {
      throw options.rollbackFailure(cause, rollbackCause);
    }
    throw cause;
  }
}
