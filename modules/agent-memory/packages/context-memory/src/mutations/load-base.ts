import type { MemorySnapshot } from '../types/document.js';
import type { MemoryStore } from '../persistence/index.js';
import type { MutationRequest, MemoryReceipt } from '../types/receipt.js';
import { ContextMemoryError } from '../errors.js';
import { integer } from '../values/index.js';
import { loadMemory, replayMutation } from '../persistence/index.js';

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
