import type { MemoryStore } from './types/store.js';
import type { MutationRequest, MemoryReceipt, MutationResult } from '../types/receipt.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { assertReceiptMatches } from './receipt-match.js';
import { parseMemoryReceipt } from './receipt.js';

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
