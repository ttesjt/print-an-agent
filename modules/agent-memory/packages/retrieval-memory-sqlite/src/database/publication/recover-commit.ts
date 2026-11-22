import { RetrievalMemoryError, type RetrievalReceipt } from '@print-an-agent/retrieval-memory';

export function recoverCommit(
  cause: unknown,
  recovered: RetrievalReceipt | undefined,
  memoryId: string,
  requestId: string
): RetrievalReceipt {
  if (recovered !== undefined) {
    if (cause instanceof RetrievalMemoryError && cause.code === 'OPERATION_ABORTED')
      return recovered;
    throw new RetrievalMemoryError(
      cause instanceof RetrievalMemoryError ? cause.code : 'STORAGE_FAILED',
      'Receipt recovered, but transaction cleanup failed.',
      { cause, commit: { status: 'committed', receipt: recovered } }
    );
  }
  if (
    cause instanceof RetrievalMemoryError &&
    (cause.code === 'COMMIT_UNKNOWN' ||
      cause.code === 'CLEANUP_FAILED' ||
      cause.commit?.status === 'unknown')
  )
    throw new RetrievalMemoryError(cause.code, cause.message, {
      cause,
      commit: { status: 'unknown', memoryId, requestId },
    });
  throw cause;
}
