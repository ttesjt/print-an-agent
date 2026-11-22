import {
  MAX_MEMORY_HISTORY_CURSOR_CHARACTERS,
  DEFAULT_MEMORY_HISTORY_PAGE_SIZE,
  MAX_MEMORY_HISTORY_PAGE_SIZE,
} from './limits.js';
import type { ForkMemoryInput } from './types/fork.js';
import type { ListMemoryVersionsInput } from './types/queries.js';
import type { MemoryVersionReference } from './types/reference.js';
import { ContextMemoryError } from '../errors.js';
import { identity, integer, keys, record } from '../values/index.js';

export function parseMemoryVersionReference(value: unknown): MemoryVersionReference {
  const input = record(value, 'version reference');
  keys(input, ['memoryId', 'revision']);
  return {
    memoryId: identity(input.memoryId, 'memoryId'),
    revision: integer(input.revision, 'revision', 1),
  };
}

export function parseForkMemoryInput(value: unknown): ForkMemoryInput {
  const input = record(value, 'fork input');
  keys(input, ['memoryId', 'requestId', 'source']);
  const memoryId = identity(input.memoryId, 'memoryId');
  const source = parseMemoryVersionReference(input.source);
  if (source.memoryId === memoryId)
    throw new ContextMemoryError(
      'INPUT_INVALID',
      'Fork source and target must be different documents.'
    );
  return { memoryId, requestId: identity(input.requestId, 'requestId'), source };
}

export function parseListMemoryVersionsInput(
  value: unknown
): Required<Pick<ListMemoryVersionsInput, 'memoryId' | 'limit'>> &
  Pick<ListMemoryVersionsInput, 'cursor'> {
  const input = record(value, 'history input');
  keys(input, ['memoryId', 'limit', 'cursor']);
  const limit =
    input.limit === undefined ? DEFAULT_MEMORY_HISTORY_PAGE_SIZE : integer(input.limit, 'limit', 1);
  if (limit > MAX_MEMORY_HISTORY_PAGE_SIZE)
    throw new ContextMemoryError('INPUT_INVALID', 'History page is too large.');
  const cursor = input.cursor === undefined ? undefined : identity(input.cursor, 'cursor');
  if (cursor !== undefined && cursor.length > MAX_MEMORY_HISTORY_CURSOR_CHARACTERS)
    throw new ContextMemoryError('INPUT_INVALID', 'History cursor is too long.');
  return {
    memoryId: identity(input.memoryId, 'memoryId'),
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  };
}
