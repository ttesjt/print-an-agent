import type { MemorySnapshot } from '../types/document.js';
import type { MemoryHistoryStore } from './types/store.js';
import type { MemoryVersionReference } from './types/reference.js';
import type { MemoryStore } from '../persistence/index.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { parseMemorySnapshot } from '../document/index.js';
import { parseMemoryVersionReference } from './parse-input.js';
import { verifyHistoryResponse } from './response.js';

export function supportsMemoryHistory(store: MemoryStore): store is MemoryHistoryStore {
  return (
    'readVersion' in store &&
    typeof store.readVersion === 'function' &&
    'listVersions' in store &&
    typeof store.listVersions === 'function' &&
    'fork' in store &&
    typeof store.fork === 'function'
  );
}

export async function inspectMemoryVersion(
  store: MemoryHistoryStore,
  value: MemoryVersionReference,
  signal?: AbortSignal
): Promise<MemorySnapshot> {
  const input = parseMemoryVersionReference(value);
  assertMemoryNotAborted(signal);
  const valueAtRevision = await store.readVersion(input, signal);
  assertMemoryNotAborted(signal);
  if (valueAtRevision === undefined)
    throw new ContextMemoryError('MEMORY_VERSION_NOT_FOUND', 'Memory version was not found.', {
      memoryId: input.memoryId,
      details: { revision: input.revision },
    });
  const snapshot = verifyHistoryResponse(input.memoryId, () =>
    parseMemorySnapshot(valueAtRevision)
  );
  if (snapshot.memoryId !== input.memoryId || snapshot.revision !== input.revision)
    throw new ContextMemoryError('HISTORY_CORRUPT', 'History returned a different version.', {
      memoryId: input.memoryId,
    });
  return snapshot;
}
