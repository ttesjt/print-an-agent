import type { ForkMemoryInput } from './types/fork.js';
import type { MemoryHistoryStore } from './types/store.js';
import type { MutationResult } from '../types/receipt.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import {
  assertReceiptMatches,
  parseMemoryReceipt,
  mutationResult,
  replayMutation,
} from '../persistence/index.js';
import { parseForkMemoryInput } from './parse-input.js';
import { parseMemoryForkRequest } from './fork-request.js';

export async function forkMemory(
  store: MemoryHistoryStore,
  value: ForkMemoryInput,
  signal?: AbortSignal
): Promise<MutationResult> {
  const input = parseForkMemoryInput(value);
  const { request } = parseMemoryForkRequest(input);
  const replay = await replayMutation(store, request, signal);
  if (replay !== undefined) return mutationResult(replay);
  assertMemoryNotAborted(signal);
  try {
    const receipt = parseMemoryReceipt(await store.fork(input, signal));
    assertReceiptMatches(receipt, request);
    return mutationResult(receipt);
  } catch (cause) {
    if (cause instanceof ContextMemoryError && cause.commit !== undefined) throw cause;
    throw new ContextMemoryError(
      'COMMIT_STATUS_UNKNOWN',
      'Fork result is unknown; recover the original request receipt.',
      {
        memoryId: input.memoryId,
        cause,
        commit: { status: 'unknown', memoryId: input.memoryId, requestId: input.requestId },
      }
    );
  }
}
