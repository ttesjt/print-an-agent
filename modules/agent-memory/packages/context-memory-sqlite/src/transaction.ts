import type { DatabaseSync } from 'node:sqlite';
import {
  assertMemoryNotAborted,
  assertReceiptMatches,
  ContextMemoryError,
  decideMemoryCommit,
  type MemoryReceipt,
  type StoreCommit,
} from '@ta-agent/context-memory';
import { readReceipt, readSnapshot, writeReceipt, writeSnapshot } from './records.js';

/** Synchronous transaction: all model/measurement work has already completed before admission. */
export function commitTransaction(
  database: DatabaseSync,
  change: StoreCommit,
  signal?: AbortSignal
): MemoryReceipt {
  assertMemoryNotAborted(signal);
  if (database.isTransaction)
    throw new ContextMemoryError(
      'STORAGE_FAILED',
      'Memory adapter cannot join a caller-owned transaction.',
      { commit: { status: 'not-committed' } }
    );
  let started = false;
  let beginAttempted = false;
  let knownReceipt: MemoryReceipt | undefined;
  try {
    beginAttempted = true;
    database.exec('BEGIN IMMEDIATE');
    started = true;
    assertMemoryNotAborted(signal);
    const existing = readReceipt(database, change.request.memoryId, change.request.requestId);
    if (existing !== undefined) {
      assertReceiptMatches(existing, change.request);
      knownReceipt = existing;
    } else {
      const decision = decideMemoryCommit(readSnapshot(database, change.request.memoryId), change);
      assertMemoryNotAborted(signal);
      writeSnapshot(database, decision.snapshot);
      writeReceipt(database, decision.receipt);
      assertMemoryNotAborted(signal);
      database.exec('COMMIT');
      // No cancellation check past this commit point.
      return decision.receipt;
    }
    database.exec('COMMIT');
    return existing;
  } catch (cause) {
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
        const recovered = readReceipt(database, change.request.memoryId, change.request.requestId);
        if (recovered !== undefined) {
          assertReceiptMatches(recovered, change.request);
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
              memoryId: change.request.memoryId,
              requestId: change.request.requestId,
            };
    if (rollbackError !== undefined)
      throw new ContextMemoryError('CLEANUP_FAILED', 'Memory transaction rollback failed.', {
        memoryId: change.request.memoryId,
        cause: new AggregateError(
          [cause, rollbackError],
          'Memory transaction and rollback failed.',
          { cause }
        ),
        commit,
      });
    if (cause instanceof ContextMemoryError && commit.status === 'not-committed')
      throw new ContextMemoryError(cause.code, cause.message, {
        memoryId: change.request.memoryId,
        cause,
        details: cause.details,
        commit,
      });
    throw new ContextMemoryError(
      commit.status === 'unknown' ? 'COMMIT_STATUS_UNKNOWN' : 'STORAGE_FAILED',
      'Memory transaction failed.',
      { memoryId: change.request.memoryId, cause, commit }
    );
  }
}
