import type { DatabaseSync } from 'node:sqlite';
import { assertReceiptMatches, ContextMemoryError } from '@print-an-agent/context-memory';
import type { MutationRequest } from '@print-an-agent/context-memory';
import { readReceipt } from '../persistence/index.js';
import type { TransactionProgress } from './types.js';

export function recoverMemoryTransactionFailure(
  database: DatabaseSync,
  request: MutationRequest,
  cause: unknown,
  progress: TransactionProgress
): never {
  const { beginAttempted, started } = progress;
  let { knownReceipt } = progress;
  let rollbackError: unknown;
  let rolledBack = false;
  if (beginAttempted && database.isOpen && database.isTransaction) {
    try {
      database.exec('ROLLBACK');
      rolledBack = true;
    } catch (error) {
      rollbackError = error;
    }
  }
  if (
    knownReceipt === undefined &&
    started &&
    !rolledBack &&
    (!database.isOpen || !database.isTransaction)
  ) {
    // COMMIT may have succeeded before an I/O wrapper or connection failure was reported.
    try {
      const recovered = readReceipt(database, request.memoryId, request.requestId);
      if (recovered !== undefined) {
        assertReceiptMatches(recovered, request);
        knownReceipt = recovered;
      }
    } catch {
      /* Recovery failure cannot prove that no commit occurred. */
    }
  }
  const commit =
    knownReceipt !== undefined
      ? { status: 'committed' as const, receipt: knownReceipt }
      : !started || rolledBack
        ? { status: 'not-committed' as const }
        : {
            status: 'unknown' as const,
            memoryId: request.memoryId,
            requestId: request.requestId,
          };
  if (rollbackError !== undefined)
    throw new ContextMemoryError('CLEANUP_FAILED', 'Memory transaction rollback failed.', {
      memoryId: request.memoryId,
      cause: new AggregateError([cause, rollbackError], 'Memory transaction and rollback failed.', {
        cause,
      }),
      commit,
    });
  if (cause instanceof ContextMemoryError && commit.status === 'not-committed')
    throw new ContextMemoryError(cause.code, cause.message, {
      memoryId: request.memoryId,
      cause,
      details: cause.details,
      commit,
    });
  throw new ContextMemoryError(
    commit.status === 'unknown' ? 'COMMIT_STATUS_UNKNOWN' : 'STORAGE_FAILED',
    'Memory transaction failed.',
    { memoryId: request.memoryId, cause, commit }
  );
}
