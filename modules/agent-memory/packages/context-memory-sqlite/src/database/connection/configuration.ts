import type { SqliteConnectionOptions } from './types.js';
import { ContextMemoryError } from '@print-an-agent/context-memory';

export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000;

export function memoryConnectionTimeout(
  options: Extract<SqliteConnectionOptions, { readonly path: string }>
): number {
  if (typeof options.path !== 'string' || options.path.length === 0)
    throw new ContextMemoryError('CONFIG_INVALID', 'SQLite path is required.');
  const timeout = options.busyTimeoutMs ?? DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 0)
    throw new ContextMemoryError(
      'CONFIG_INVALID',
      'SQLite busy timeout must be a nonnegative safe integer.'
    );
  return timeout;
}
