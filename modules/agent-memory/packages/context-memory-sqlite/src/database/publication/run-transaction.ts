import { recoverMemoryTransactionFailure } from './recover-commit.js';
import type { DatabaseSync } from 'node:sqlite';
import {
  assertMemoryNotAborted,
  assertReceiptMatches,
  ContextMemoryError,
} from '@print-an-agent/context-memory';
import type { MemoryReceipt, MutationRequest } from '@print-an-agent/context-memory';
import { readReceipt, writeReceipt } from '../persistence/index.js';

/** Replay arbitration and publication share one transaction, including fork source reads. */
export function runMemoryTransaction(
  database: DatabaseSync,
  request: MutationRequest,
  publish: () => MemoryReceipt,
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
    const existing = readReceipt(database, request.memoryId, request.requestId);
    if (existing !== undefined) {
      assertReceiptMatches(existing, request);
      knownReceipt = existing;
    } else {
      const receipt = publish();
      assertMemoryNotAborted(signal);
      writeReceipt(database, receipt);
      assertMemoryNotAborted(signal);
      database.exec('COMMIT');
      // No cancellation check past this commit point.
      return receipt;
    }
    database.exec('COMMIT');
    return existing;
  } catch (cause) {
    return recoverMemoryTransactionFailure(database, request, cause, {
      beginAttempted,
      started,
      knownReceipt,
    });
  }
}
