import { AgentRequestError } from '@print-an-agent/base-request';
import { AgentSessionError } from '@print-an-agent/base-session';
import { lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { runSqliteTransaction, useSqliteConnection } from '../../../sqlite/index.js';
import type { RequestJournalDatabaseConfiguration } from './types/database.js';

const DEFAULT_BUSY_TIMEOUT_MILLISECONDS = 5_000;

const MAX_BUSY_TIMEOUT_MILLISECONDS = 2_147_483_647;

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
  return useSqliteConnection(configuration, action, {
    operation: (cause) =>
      cause instanceof AgentRequestError || cause instanceof AgentSessionError
        ? cause
        : new AgentRequestError(
            'REQUEST_REPLAY_STORAGE_FAILED',
            `SQLite Request Journal operation "${operation}" failed.`,
            { cause }
          ),
    close: (cause) =>
      new AgentRequestError(
        'REQUEST_REPLAY_STORAGE_FAILED',
        `Closing SQLite Request Journal operation "${operation}" failed.`,
        { cause }
      ),
    combine: (operationError, closeError) =>
      new AggregateError(
        [operationError, closeError],
        `SQLite Request Journal operation "${operation}" and connection cleanup both failed.`
      ),
  });
}

export function runImmediateTransaction<T>(database: DatabaseSync, action: () => T): T {
  return runSqliteTransaction(database, action, {
    begin: 'BEGIN IMMEDIATE',
    existing: 'start',
    rollbackFailure: (cause, rollbackCause) =>
      new AggregateError(
        [cause, rollbackCause],
        'SQLite Request Journal transaction rollback failed.'
      ),
  });
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
