import { memoryConnectionTimeout } from './configuration.js';
import type { SqliteConnectionOptions, OpenedMemoryConnection } from './types.js';
import { DatabaseSync } from 'node:sqlite';
import { ContextMemoryError } from '@print-an-agent/context-memory';

function openMemoryDatabase(path: string, timeout: number): DatabaseSync {
  try {
    return new DatabaseSync(path, { timeout });
  } catch (cause) {
    throw new ContextMemoryError('STORAGE_FAILED', 'Memory database could not be opened.', {
      cause,
    });
  }
}

export function openMemoryConnection(options: SqliteConnectionOptions): OpenedMemoryConnection {
  if (options.database !== undefined) return { database: options.database, owned: false };
  const timeout = memoryConnectionTimeout(options);
  return { database: openMemoryDatabase(options.path, timeout), owned: true };
}
