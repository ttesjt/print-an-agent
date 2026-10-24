import type { DatabaseSync } from 'node:sqlite';
import { RetrievalMemoryError } from '@ta-agent/retrieval-memory';
export function checkCancellation(flag: Int32Array): void {
  if (Atomics.load(flag, 0) !== 0)
    throw new RetrievalMemoryError('OPERATION_ABORTED', 'SQLite operation was cancelled.');
}
export function transaction<T>(
  db: DatabaseSync,
  mode: 'read' | 'write',
  flag: Int32Array,
  work: () => T
): T {
  let committing = false;
  try {
    checkCancellation(flag);
    db.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN');
    checkCancellation(flag);
    const result = work();
    checkCancellation(flag);
    committing = true;
    db.exec('COMMIT');
    return result;
  } catch (cause) {
    try {
      if (db.isTransaction) db.exec('ROLLBACK');
    } catch (cleanup) {
      throw new RetrievalMemoryError(
        'CLEANUP_FAILED',
        'SQLite rollback could not be established.',
        {
          cause: new AggregateError([cause, cleanup]),
        }
      );
    }
    if (cause instanceof RetrievalMemoryError)
      throw new RetrievalMemoryError(cause.code, cause.message, {
        cause,
        ...(mode === 'write' && !committing
          ? { commit: { status: 'not-committed' } as const }
          : {}),
      });
    throw new RetrievalMemoryError(
      committing && mode === 'write' ? 'COMMIT_UNKNOWN' : 'STORAGE_FAILED',
      'SQLite transaction failed.',
      {
        cause,
        ...(mode === 'write' && !committing
          ? { commit: { status: 'not-committed' } as const }
          : {}),
      }
    );
  }
}
