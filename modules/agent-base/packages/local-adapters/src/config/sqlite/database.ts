import { AgentConfigError } from '@print-an-agent/base-identity-config/config';
import { lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { runSqliteTransaction, useSqliteConnection } from '../../sqlite/index.js';
import type { ConfigDatabaseConfiguration } from './types/database.js';

const DEFAULT_BUSY_TIMEOUT_MILLISECONDS = 5_000;

const MAX_BUSY_TIMEOUT_MILLISECONDS = 2_147_483_647;

function normalizeBusyTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_BUSY_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_BUSY_TIMEOUT_MILLISECONDS) {
    throw new AgentConfigError(
      'CONFIG_CONFIGURATION_INVALID',
      `SQLite Config busy timeout must be between 1 and ${MAX_BUSY_TIMEOUT_MILLISECONDS} milliseconds.`
    );
  }
  return timeout;
}

function normalizeDatabasePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value === ':memory:') {
    throw new AgentConfigError(
      'CONFIG_PATH_INVALID',
      'SQLite Config requires an explicit file path.'
    );
  }
  const databasePath = resolve(value);
  mkdirSync(dirname(databasePath), { recursive: true });
  try {
    const target = lstatSync(databasePath);
    if (!target.isFile() || target.isSymbolicLink()) {
      throw new AgentConfigError(
        'CONFIG_PATH_INVALID',
        'SQLite Config path must name a regular file and cannot be a symbolic link.'
      );
    }
  } catch (cause: unknown) {
    if (cause instanceof AgentConfigError) throw cause;
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
      return databasePath;
    }
    throw new AgentConfigError('CONFIG_PATH_INVALID', 'Unable to inspect SQLite Config path.', {
      cause,
    });
  }
  return databasePath;
}

export function defineConfigDatabaseConfiguration(
  databasePath: unknown,
  busyTimeoutMilliseconds: number | undefined
): ConfigDatabaseConfiguration {
  return Object.freeze({
    databasePath: normalizeDatabasePath(databasePath),
    busyTimeoutMilliseconds: normalizeBusyTimeout(busyTimeoutMilliseconds),
  });
}

export function useConfigDatabase<T>(
  configuration: ConfigDatabaseConfiguration,
  operation: string,
  action: (database: DatabaseSync) => T
): T {
  return useSqliteConnection(configuration, action, {
    operation: (cause) =>
      cause instanceof AgentConfigError
        ? cause
        : new AgentConfigError(
            'CONFIG_STORAGE_FAILED',
            `SQLite Config operation "${operation}" failed.`,
            { cause }
          ),
    close: (cause) =>
      new AgentConfigError(
        'CONFIG_STORAGE_FAILED',
        `Closing SQLite Config operation "${operation}" failed.`,
        { cause }
      ),
    combine: (operationError, closeError) =>
      new AggregateError(
        [operationError, closeError],
        `SQLite Config operation "${operation}" and cleanup both failed.`
      ),
  });
}

export function runConfigTransaction<T>(database: DatabaseSync, action: () => T): T {
  return runSqliteTransaction(database, action, {
    begin: 'BEGIN IMMEDIATE',
    existing: 'start',
    rollbackFailure: (cause, rollbackCause) =>
      new AggregateError([cause, rollbackCause], 'SQLite Config transaction rollback failed.'),
  });
}
