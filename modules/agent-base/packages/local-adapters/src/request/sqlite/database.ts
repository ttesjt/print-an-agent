import { lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentRequestError } from '@ta-agent/base-request';

const DEFAULT_BUSY_TIMEOUT_MILLISECONDS = 5_000;
const MAX_BUSY_TIMEOUT_MILLISECONDS = 2_147_483_647;

export interface RequestJournalDatabaseConfiguration {
  readonly databasePath: string;
  readonly busyTimeoutMilliseconds: number;
}

function normalizeBusyTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_BUSY_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_BUSY_TIMEOUT_MILLISECONDS) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_CONFIGURATION_INVALID',
      `Request Journal SQLite busy timeout must be a safe integer between 1 and ${MAX_BUSY_TIMEOUT_MILLISECONDS} milliseconds.`
    );
  }
  return timeout;
}

function normalizeDatabasePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value === ':memory:') {
    throw new AgentRequestError(
      'REQUEST_REPLAY_PATH_INVALID',
      'SQLite Request Journal requires an explicit file path; use MemoryRequestJournalAdapter for in-memory storage.'
    );
  }
  const databasePath = resolve(value);
  mkdirSync(dirname(databasePath), { recursive: true });
  try {
    const target = lstatSync(databasePath);
    if (!target.isFile() || target.isSymbolicLink()) {
      throw new AgentRequestError(
        'REQUEST_REPLAY_PATH_INVALID',
        'SQLite Request Journal path must name a regular file and cannot be a symbolic link.'
      );
    }
  } catch (cause: unknown) {
    if (cause instanceof AgentRequestError) throw cause;
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
      return databasePath;
    }
    throw new AgentRequestError(
      'REQUEST_REPLAY_PATH_INVALID',
      `Unable to inspect SQLite Request Journal path "${databasePath}".`,
      { cause }
    );
  }
  return databasePath;
}

export function defineRequestJournalDatabaseConfiguration(
  databasePath: unknown,
  busyTimeoutMilliseconds: number | undefined
): RequestJournalDatabaseConfiguration {
  try {
    const normalizedBusyTimeout = normalizeBusyTimeout(busyTimeoutMilliseconds);
    return Object.freeze({
      databasePath: normalizeDatabasePath(databasePath),
      busyTimeoutMilliseconds: normalizedBusyTimeout,
    });
  } catch (cause: unknown) {
    if (cause instanceof AgentRequestError) throw cause;
    throw new AgentRequestError(
      'REQUEST_REPLAY_PATH_INVALID',
      'Unable to prepare the SQLite Request Journal path.',
      { cause }
    );
  }
}

export function useRequestJournalDatabase<T>(
  configuration: RequestJournalDatabaseConfiguration,
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

  let closeError: AgentRequestError | undefined;
  try {
    if (database?.isOpen === true) database.close();
  } catch (cause: unknown) {
    closeError = new AgentRequestError(
      'REQUEST_REPLAY_STORAGE_FAILED',
      `Closing SQLite Request Journal operation "${operation}" failed.`,
      { cause }
    );
  }

  if (outcome.status === 'failure') {
    const operationError =
      outcome.error instanceof AgentRequestError
        ? outcome.error
        : new AgentRequestError(
            'REQUEST_REPLAY_STORAGE_FAILED',
            `SQLite Request Journal operation "${operation}" failed.`,
            { cause: outcome.error }
          );
    if (closeError !== undefined) {
      throw new AggregateError(
        [operationError, closeError],
        `SQLite Request Journal operation "${operation}" and connection cleanup both failed.`
      );
    }
    throw operationError;
  }
  if (closeError !== undefined) throw closeError;
  return outcome.value;
}

export function runImmediateTransaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec('BEGIN IMMEDIATE');
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
        'SQLite Request Journal transaction rollback failed.'
      );
    }
    throw cause;
  }
}

export function readJournalClock(clock: () => number): number {
  const timestamp = clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_CONFIGURATION_INVALID',
      'SQLite Request Journal clock must return a non-negative safe integer timestamp.'
    );
  }
  return timestamp;
}
