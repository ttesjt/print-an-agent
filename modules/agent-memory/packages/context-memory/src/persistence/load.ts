import type { MemorySnapshot } from '../types/document.js';
import type { MemoryStore } from './types/store.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { parseMemorySnapshot } from '../document/index.js';

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
