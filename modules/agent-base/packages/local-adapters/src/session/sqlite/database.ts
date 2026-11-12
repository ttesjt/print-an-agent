import { lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentSessionError } from '@print-an-agent/base-session';

const DEFAULT_BUSY_TIMEOUT_MILLISECONDS = 5_000;
const MAX_BUSY_TIMEOUT_MILLISECONDS = 2_147_483_647;

export interface SqliteDatabaseConfiguration {
  readonly databasePath: string;
  readonly busyTimeoutMilliseconds: number;
}

function normalizeBusyTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_BUSY_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_BUSY_TIMEOUT_MILLISECONDS) {
    throw new AgentSessionError(
      'SESSION_CONFIGURATION_INVALID',
      `SQLite busy timeout must be a safe integer between 1 and ${MAX_BUSY_TIMEOUT_MILLISECONDS} milliseconds.`
    );
  }
  return timeout;
}

function normalizeDatabasePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value === ':memory:') {
    throw new AgentSessionError(
      'SESSION_PATH_INVALID',
      'SQLite Session requires an explicit file path; use MemorySessionAdapter for in-memory storage.'
    );
  }

  const databasePath = resolve(value);
  mkdirSync(dirname(databasePath), { recursive: true });

  try {
    const target = lstatSync(databasePath);
    if (!target.isFile() || target.isSymbolicLink()) {
      throw new AgentSessionError(
        'SESSION_PATH_INVALID',
        'SQLite Session database path must name a regular file and cannot be a symbolic link.'
      );
    }
  } catch (cause: unknown) {
    if (cause instanceof AgentSessionError) throw cause;
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
      return databasePath;
    }
    throw new AgentSessionError(
      'SESSION_PATH_INVALID',
      `Unable to inspect SQLite Session database path "${databasePath}".`,
      { cause }
    );
  }

  return databasePath;
}

export function defineSqliteDatabaseConfiguration(
  databasePath: unknown,
  busyTimeoutMilliseconds: number | undefined
): SqliteDatabaseConfiguration {
  try {
    const normalizedBusyTimeout = normalizeBusyTimeout(busyTimeoutMilliseconds);
    return Object.freeze({
      databasePath: normalizeDatabasePath(databasePath),
      busyTimeoutMilliseconds: normalizedBusyTimeout,
    });
  } catch (cause: unknown) {
    if (cause instanceof AgentSessionError) throw cause;
    throw new AgentSessionError(
      'SESSION_PATH_INVALID',
      'Unable to prepare the SQLite Session database path.',
      { cause }
    );
  }
}

export function useSqliteDatabase<T>(
  configuration: SqliteDatabaseConfiguration,
  operation: string,
  action: (database: DatabaseSync) => T
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

  let closeError: AgentSessionError | undefined;
  try {
    if (database?.isOpen === true) database.close();
  } catch (cause: unknown) {
    closeError = new AgentSessionError(
      'SESSION_STORAGE_FAILED',
      `Closing SQLite Session operation "${operation}" failed.`,
      { cause }
    );
  }

  if (outcome.status === 'failure') {
    const operationError =
      outcome.error instanceof AgentSessionError
        ? outcome.error
        : new AgentSessionError(
            'SESSION_STORAGE_FAILED',
            `SQLite Session operation "${operation}" failed.`,
            { cause: outcome.error }
          );
    if (closeError !== undefined) {
      throw new AggregateError(
        [operationError, closeError],
        `SQLite Session operation "${operation}" and connection cleanup both failed.`
      );
    }
    throw operationError;
  }
  if (closeError !== undefined) throw closeError;
  return outcome.value;
}

export function runImmediateTransaction<T>(database: DatabaseSync, action: () => T): T {
  return runTransaction(database, 'BEGIN IMMEDIATE', action);
}

export function runReadTransaction<T>(database: DatabaseSync, action: () => T): T {
  return runTransaction(database, 'BEGIN', action);
}

function runTransaction<T>(
  database: DatabaseSync,
  begin: 'BEGIN' | 'BEGIN IMMEDIATE',
  action: () => T
): T {
  // Internal storage helpers join the enclosing synchronous adapter transaction.
  if (database.isTransaction) return action();
  database.exec(begin);
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (cause: unknown) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackCause: unknown) {
      throw new AggregateError(
        [cause, rollbackCause],
        'SQLite Session transaction rollback failed.'
      );
    }
    throw cause;
  }
}

export function readClock(clock: () => number): number {
  const timestamp = clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AgentSessionError(
      'SESSION_CONFIGURATION_INVALID',
      'SQLite Session clock must return a non-negative safe integer timestamp.'
    );
  }
  return timestamp;
}
