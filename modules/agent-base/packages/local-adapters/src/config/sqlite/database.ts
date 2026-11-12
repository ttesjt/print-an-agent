import { lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentConfigError } from '@print-an-agent/base-config';

const DEFAULT_BUSY_TIMEOUT_MILLISECONDS = 5_000;
const MAX_BUSY_TIMEOUT_MILLISECONDS = 2_147_483_647;

export interface ConfigDatabaseConfiguration {
  readonly databasePath: string;
  readonly busyTimeoutMilliseconds: number;
}

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

  let closeError: AgentConfigError | undefined;
  try {
    if (database?.isOpen === true) database.close();
  } catch (cause: unknown) {
    closeError = new AgentConfigError(
      'CONFIG_STORAGE_FAILED',
      `Closing SQLite Config operation "${operation}" failed.`,
      { cause }
    );
  }
  if (outcome.status === 'failure') {
    const operationError =
      outcome.error instanceof AgentConfigError
        ? outcome.error
        : new AgentConfigError(
            'CONFIG_STORAGE_FAILED',
            `SQLite Config operation "${operation}" failed.`,
            { cause: outcome.error }
          );
    if (closeError !== undefined) {
      throw new AggregateError(
        [operationError, closeError],
        `SQLite Config operation "${operation}" and cleanup both failed.`
      );
    }
    throw operationError;
  }
  if (closeError !== undefined) throw closeError;
  return outcome.value;
}

export function runConfigTransaction<T>(database: DatabaseSync, action: () => T): T {
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
        'SQLite Config transaction rollback failed.'
      );
    }
    throw cause;
  }
}
