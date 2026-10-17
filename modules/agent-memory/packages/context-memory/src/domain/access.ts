import type { MemorySnapshot } from '../contracts/document.js';
import type { MemoryStore } from '../contracts/ports.js';
import type {
  MutationRequest,
  MemoryReceipt,
  StoreCommit,
  MutationResult,
} from '../contracts/receipt.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { assertReceiptMatches } from '../persistence/decision.js';
import { parseMemoryReceipt } from '../validation/receipt.js';
import { parseMemorySnapshot } from '../validation/state.js';
import { integer } from '../validation/value.js';

export async function loadMemory(
  store: MemoryStore,
  memoryId: string,
  signal?: AbortSignal
): Promise<MemorySnapshot> {
  assertMemoryNotAborted(signal);
  try {
    const value = await store.read(memoryId, signal);
    assertMemoryNotAborted(signal);
    if (value === undefined)
      throw new ContextMemoryError('MEMORY_NOT_FOUND', 'Memory was not found.', { memoryId });
    const snapshot = parseMemorySnapshot(value);
    if (snapshot.memoryId !== memoryId) throw new Error('Snapshot scope mismatch.');
    return snapshot;
  } catch (cause) {
    if (
      cause instanceof ContextMemoryError &&
      ['MEMORY_NOT_FOUND', 'OPERATION_ABORTED'].includes(cause.code)
    )
      throw cause;
    assertMemoryNotAborted(signal);
    throw new ContextMemoryError('STORAGE_FAILED', 'Memory snapshot could not be read.', {
      memoryId,
      cause,
    });
  }
}

/** A stale snapshot can mean this request committed after the initial receipt lookup. */
export async function loadMutationBase(
  store: MemoryStore,
  request: MutationRequest,
  expectedRevision: unknown,
  signal?: AbortSignal
): Promise<{ snapshot: MemorySnapshot; expectedRevision: number } | { receipt: MemoryReceipt }> {
  const snapshot = await loadMemory(store, request.memoryId, signal);
  const expected = integer(expectedRevision, 'expectedRevision', 1);
  if (expected === snapshot.revision) return { snapshot, expectedRevision: expected };
  const receipt = await replayMutation(store, request, signal);
  if (receipt !== undefined) return { receipt };
  throw new ContextMemoryError('REVISION_CONFLICT', 'Memory revision changed.', {
    details: { expectedRevision: expected, actualRevision: snapshot.revision },
  });
}

export async function replayMutation(
  store: MemoryStore,
  request: MutationRequest,
  signal?: AbortSignal
): Promise<MemoryReceipt | undefined> {
  assertMemoryNotAborted(signal);
  let receipt: MemoryReceipt | undefined;
  try {
    const value = await store.getReceipt(request.memoryId, request.requestId, signal);
    receipt = value === undefined ? undefined : parseMemoryReceipt(value);
  } catch (cause) {
    assertMemoryNotAborted(signal);
    if (cause instanceof ContextMemoryError && cause.code === 'OPERATION_ABORTED') throw cause;
    throw new ContextMemoryError('STORAGE_FAILED', 'Memory receipt could not be read.', {
      memoryId: request.memoryId,
      cause,
    });
  }
  if (receipt !== undefined) {
    assertReceiptMatches(receipt, request);
    // A validated durable fact takes precedence over cancellation delivered with the read.
    return receipt;
  }
  assertMemoryNotAborted(signal);
  return undefined;
}
export function mutationResult(receipt: MemoryReceipt): MutationResult {
  return { status: receipt.status, receipt };
}

export async function persistMemory(
  store: MemoryStore,
  change: StoreCommit,
  signal?: AbortSignal
): Promise<MutationResult> {
  assertMemoryNotAborted(signal);
  const unknownCommit = (cause: unknown): never => {
    throw new ContextMemoryError(
      'COMMIT_STATUS_UNKNOWN',
      'Memory commit result could not be established; query its receipt before retrying.',
      {
        memoryId: change.request.memoryId,
        cause,
        commit: {
          status: 'unknown',
          memoryId: change.request.memoryId,
          requestId: change.request.requestId,
        },
      }
    );
  };
  let value: MemoryReceipt;
  try {
    value = await store.commit(change, signal);
  } catch (cause) {
    if (cause instanceof ContextMemoryError && cause.commit !== undefined) throw cause;
    return unknownCommit(cause);
  }
  try {
    const receipt = parseMemoryReceipt(value);
    assertReceiptMatches(receipt, change.request);
    // Never rewrite a completed durable operation because cancellation arrived after its commit.
    return mutationResult(receipt);
  } catch (cause) {
    return unknownCommit(cause);
  }
}
