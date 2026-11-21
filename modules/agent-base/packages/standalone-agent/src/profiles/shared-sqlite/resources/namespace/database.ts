import { ManagedAgentNamespaceError } from '@print-an-agent/base-composition';
import { lstatSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentBaseStandaloneError } from '../../../../errors.js';
import { storageError } from './errors.js';
import { assertSchema } from './schema.js';
import type { SharedSqliteConfiguration } from './types.js';

const DEFAULT_BUSY_TIMEOUT_MILLISECONDS = 5_000;

const MAX_BUSY_TIMEOUT_MILLISECONDS = 2_147_483_647;

export function normalizeBusyTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_BUSY_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_BUSY_TIMEOUT_MILLISECONDS) {
    throw storageError(
      `Shared SQLite busy timeout must be between 1 and ${MAX_BUSY_TIMEOUT_MILLISECONDS} milliseconds.`
    );
  }
  return timeout;
}

export function normalizeDatabasePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value === ':memory:' ||
    !isAbsolute(value)
  ) {
    throw storageError('Shared SQLite requires an explicit absolute file path.');
  }
  const databasePath = resolve(value);
  mkdirSync(dirname(databasePath), { recursive: true });
  try {
    const metadata = lstatSync(databasePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw storageError(
        'Shared SQLite path must name a regular file and cannot be a symbolic link.'
      );
    }
  } catch (cause: unknown) {
    if (cause instanceof AgentBaseStandaloneError) throw cause;
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
      return databasePath;
    }
    throw storageError('Shared SQLite path could not be inspected.', cause);
  }
  return databasePath;
}

export function useDatabase<T>(
  configuration: SharedSqliteConfiguration,
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
    assertSchema(database, configuration.tableNames);
    database.enableDefensive(true);
    outcome = { status: 'success', value: action(database) };
  } catch (cause: unknown) {
    outcome = { status: 'failure', error: cause };
  }

  let closeError: AgentBaseStandaloneError | undefined;
  try {
    if (database?.isOpen === true) database.close();
  } catch (cause: unknown) {
    closeError = new AgentBaseStandaloneError(
      `Closing shared SQLite namespace operation "${operation}" failed.`,
      { code: 'STANDALONE_AGENT_STORAGE_FAILED', cause }
    );
  }
  if (outcome.status === 'failure') {
    const operationError =
      outcome.error instanceof AgentBaseStandaloneError ||
      outcome.error instanceof ManagedAgentNamespaceError
        ? outcome.error
        : new AgentBaseStandaloneError(`Shared SQLite namespace operation "${operation}" failed.`, {
            code: 'STANDALONE_AGENT_STORAGE_FAILED',
            cause: outcome.error,
          });
    if (closeError !== undefined) {
      throw new AggregateError(
        [operationError, closeError],
        `Shared SQLite namespace operation "${operation}" and cleanup both failed.`
      );
    }
    throw operationError;
  }
  if (closeError !== undefined) throw closeError;
  return outcome.value;
}
