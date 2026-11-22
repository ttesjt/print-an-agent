import { identifier, RetrievalMemoryError } from '@print-an-agent/retrieval-memory';
import { SQLITE_RETRIEVAL_LIMITS } from '../capabilities.js';
import type { SqliteDatabaseConfiguration } from '../database/index.js';
import type { SqliteRetrievalOptions } from './types.js';

export function normalizeConfiguration(
  options: SqliteRetrievalOptions
): SqliteDatabaseConfiguration {
  const path = identifier(options.path);
  const busyTimeoutMs = options.busyTimeoutMs ?? SQLITE_RETRIEVAL_LIMITS.busyTimeoutMs;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0)
    throw new RetrievalMemoryError('CONFIG_INVALID', 'Invalid SQLite busy timeout.');
  return { path, busyTimeoutMs };
}
