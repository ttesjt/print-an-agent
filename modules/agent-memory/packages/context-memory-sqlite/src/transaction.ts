import type { DatabaseSync } from 'node:sqlite';
import {
  assertMemoryNotAborted,
  assertReceiptMatches,
  ContextMemoryError,
  decideMemoryCommit,
  type MemoryReceipt,
  type StoreCommit,
  type MutationRequest,
  type ForkMemoryInput,
  parseMemoryForkRequest,
} from '@print-an-agent/context-memory';
import { readReceipt, readSnapshot, writeReceipt, writeSnapshot } from './records.js';
import { appendHistory, readHistoricalSnapshot } from './history/records.js';
import { DEFAULT_MAX_MEMORY_DELTA_CHAIN } from './history/codec.js';

function publishChange(
  database: DatabaseSync,
  change: StoreCommit,
  maxDeltaChain: number
): MemoryReceipt {
  const previous = readSnapshot(database, change.request.memoryId);
  const decision = decideMemoryCommit(previous, change);
  if (decision.receipt.status !== 'unchanged') {
    appendHistory(database, decision.snapshot, previous, maxDeltaChain);
    writeSnapshot(database, decision.snapshot);
  }
  return decision.receipt;
}

/** Synchronous transaction: all model/measurement work has already completed before admission. */
export function commitTransaction(
  database: DatabaseSync,
  change: StoreCommit,
  signal?: AbortSignal,
  maxDeltaChain = DEFAULT_MAX_MEMORY_DELTA_CHAIN
): MemoryReceipt {
  return runMemoryTransaction(
    database,
    change.request,
    () => publishChange(database, change, maxDeltaChain),
    signal
  );
}

export function forkTransaction(
  database: DatabaseSync,
  value: ForkMemoryInput,
  signal: AbortSignal | undefined,
  maxDeltaChain: number
): MemoryReceipt {
  const { input, request } = parseMemoryForkRequest(value);
  return runMemoryTransaction(
    database,
    request,
    () => {
      if (readSnapshot(database, input.memoryId) !== undefined)
        throw new ContextMemoryError('MEMORY_ALREADY_EXISTS', 'Fork target already exists.', {
          memoryId: input.memoryId,
        });
      const source = readHistoricalSnapshot(database, input.source, signal);
      if (source === undefined)
        throw new ContextMemoryError(
          'MEMORY_VERSION_NOT_FOUND',
          'Source memory version was not found.',
          { memoryId: input.source.memoryId }
        );
      return publishChange(
        database,
        {
          request,
          expectedRevision: null,
          state: { items: source.items, config: source.config, measurement: source.measurement },
          commandOutcomes: [],
        },
        maxDeltaChain
      );
    },
    signal
  );
}

/** Replay arbitration and publication share one transaction, including fork source reads. */
function runMemoryTransaction(
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
        cause: new AggregateError(
          [cause, rollbackError],
          'Memory transaction and rollback failed.',
          { cause }
        ),
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
}
