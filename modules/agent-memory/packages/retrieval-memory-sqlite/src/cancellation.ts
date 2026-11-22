import { RetrievalMemoryError } from '@print-an-agent/retrieval-memory';

export function checkCancellation(flag: Int32Array): void {
  if (Atomics.load(flag, 0) !== 0)
    throw new RetrievalMemoryError('OPERATION_ABORTED', 'SQLite operation was cancelled.');
}
