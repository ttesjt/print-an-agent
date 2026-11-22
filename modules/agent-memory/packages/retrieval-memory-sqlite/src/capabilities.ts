import { RetrievalMemoryError } from '@print-an-agent/retrieval-memory';

export const SQLITE_RETRIEVAL_LIMITS = Object.freeze({
  maxDimensions: 8192,
  maxTopK: 4096,
  maxListLimit: 1000,
  busyTimeoutMs: 5000,
});

export function assertSqliteLimit(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RetrievalMemoryError(
      'UNSUPPORTED_CAPABILITY',
      'Requested limit exceeds SQLite capability.'
    );
}
