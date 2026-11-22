import { MAX_MEMORY_HISTORY_CURSOR_CHARACTERS } from './limits.js';
import type { ListMemoryVersionsInput, MemoryHistoryPage } from './types/queries.js';
import type { MemoryHistoryStore } from './types/store.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { parseMemoryVersionReference, parseListMemoryVersionsInput } from './parse-input.js';
import { integer, keys, record } from '../values/index.js';
import { verifyHistoryResponse } from './response.js';

export async function listMemoryVersions(
  store: MemoryHistoryStore,
  value: ListMemoryVersionsInput,
  signal?: AbortSignal
): Promise<MemoryHistoryPage> {
  const input = parseListMemoryVersionsInput(value);
  assertMemoryNotAborted(signal);
  const page = await store.listVersions(input, signal);
  assertMemoryNotAborted(signal);
  return verifyHistoryResponse(input.memoryId, () => {
    const data = record(page, 'history page');
    keys(data, ['memoryId', 'throughRevision', 'versions', 'nextCursor']);
    const upper = integer(data.throughRevision, 'throughRevision', 1);
    if (
      page.memoryId !== input.memoryId ||
      !Array.isArray(page.versions) ||
      page.versions.length > input.limit ||
      (page.nextCursor !== undefined &&
        (typeof page.nextCursor !== 'string' ||
          page.nextCursor.length === 0 ||
          page.nextCursor.length > MAX_MEMORY_HISTORY_CURSOR_CHARACTERS ||
          page.versions.length === 0))
    )
      throw new ContextMemoryError('HISTORY_CORRUPT', 'Invalid history page.', {
        memoryId: input.memoryId,
      });
    let previous = upper + 1;
    const versions = page.versions.map((entry) => {
      const reference = parseMemoryVersionReference(entry);
      if (reference.memoryId !== input.memoryId || reference.revision >= previous)
        throw new ContextMemoryError(
          'HISTORY_CORRUPT',
          'History page scope or ordering is invalid.'
        );
      previous = reference.revision;
      return reference;
    });
    return {
      memoryId: input.memoryId,
      throughRevision: upper,
      versions,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  });
}
