import type { MemoryStore, StoreCommit } from './types/store.js';
import type { MemoryReceipt, MutationResult } from '../types/receipt.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { assertReceiptMatches } from './receipt-match.js';
import { parseMemoryReceipt } from './receipt.js';
import { mutationResult } from './replay.js';

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
