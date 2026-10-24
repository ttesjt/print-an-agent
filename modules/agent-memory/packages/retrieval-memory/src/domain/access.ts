import type { RetrievalBackend } from '../contracts/ports.js';
import type { Mutation } from '../contracts/inputs.js';
import type { RetrievalReceipt } from '../contracts/publication.js';
import { assertNotAborted, fail } from '../errors.js';
import { parseRetrievalSpace, parseStoredEntry } from '../validation/state.js';
import { assertReceiptMatches, parseRetrievalReceipt } from './receipts.js';
export async function replayRetrieval(
  backend: RetrievalBackend,
  mutation: Mutation,
  signal?: AbortSignal
): Promise<RetrievalReceipt | undefined> {
  assertNotAborted(signal);
  const value = await backend.getReceipt(mutation.input.memoryId, mutation.input.requestId, signal);
  if (value !== undefined) {
    const receipt = parseRetrievalReceipt(value);
    assertReceiptMatches(receipt, mutation);
    return receipt; // A known durable fact wins over cancellation arriving with its delivery.
  }
  assertNotAborted(signal);
  return undefined;
}
export async function requireSpace(
  backend: RetrievalBackend,
  memoryId: string,
  signal?: AbortSignal
) {
  assertNotAborted(signal);
  const value = await backend.inspect(memoryId, signal);
  assertNotAborted(signal);
  if (value === undefined) fail('MEMORY_NOT_FOUND', 'Memory Space was not found.');
  const space = parseRetrievalSpace(value);
  if (space.memoryId !== memoryId) fail('STORAGE_FAILED', 'Backend returned an unrelated Space.');
  return space;
}
export async function requireEntry(
  backend: RetrievalBackend,
  space: Awaited<ReturnType<typeof requireSpace>>,
  entryId: string,
  signal?: AbortSignal
) {
  const value = await backend.get(space.memoryId, entryId, signal);
  assertNotAborted(signal);
  if (value === undefined) fail('ENTRY_NOT_FOUND', 'Entry was not found.');
  const stored = parseStoredEntry(value, space);
  if (stored.entry.entryId !== entryId)
    fail('STORAGE_FAILED', 'Backend returned an unrelated Entry.');
  return stored;
}
