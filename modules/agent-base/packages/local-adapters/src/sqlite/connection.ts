import { DatabaseSync } from 'node:sqlite';
import type { SqliteConnectionConfiguration, SqliteConnectionFailureMapping } from './types.js';

/** Owns exactly one synchronous connection; domain error translation stays with the caller. */
export function useSqliteConnection<T>(
  configuration: SqliteConnectionConfiguration,
  action: (database: DatabaseSync) => T,
  errors: SqliteConnectionFailureMapping
): T {
  let database: DatabaseSync | undefined;
  let outcome:
    | Readonly<{ status: 'success'; value: T }>
    | Readonly<{ status: 'failure'; error: unknown }>;
  try {
    database = new DatabaseSync(configuration.databasePath, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
    });
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = ${configuration.busyTimeoutMilliseconds};
    `);
    outcome = { status: 'success', value: action(database) };
  } catch (cause: unknown) {
    outcome = { status: 'failure', error: cause };
  }
  let closeError: Error | undefined;
  try {
    if (database?.isOpen === true) database.close();
  } catch (cause: unknown) {
    closeError = errors.close(cause);
  }
  if (outcome.status === 'failure') {
    const operationError = errors.operation(outcome.error);
    if (closeError !== undefined) throw errors.combine(operationError, closeError);
    throw operationError;
  }
  if (closeError !== undefined) throw closeError;
  return outcome.value;
}
