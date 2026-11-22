import type { RetrievalSpace } from '../types/space.js';
import type { StoredEntry } from '../types/entry.js';
import type { RetrievalBackend } from './types/ports.js';
import type { Mutation } from '../types/mutation.js';
import type { RetrievalReceipt } from '../types/publication.js';
import { assertNotAborted, fail } from '../errors.js';
import { parseRetrievalSpace } from '../content/index.js';
import { parseStoredEntry } from './stored-entry.js';
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
): Promise<RetrievalSpace> {
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
  space: RetrievalSpace,
  entryId: string,
  signal?: AbortSignal
): Promise<StoredEntry> {
  const value = await backend.get(space.memoryId, entryId, signal);
  assertNotAborted(signal);
  if (value === undefined) fail('ENTRY_NOT_FOUND', 'Entry was not found.');
  const stored = parseStoredEntry(value, space);
  if (stored.entry.entryId !== entryId)
    fail('STORAGE_FAILED', 'Backend returned an unrelated Entry.');
  return stored;
}
