import { DEFAULT_ENTRY_LIST_LIMIT } from './defaults.js';
import type { EntryInput, ReceiptInput, SpaceInput } from '../../types/identity.js';
import type { ListInput } from './types/input.js';
import type { RetrievalPolicy } from '../../policy/index.js';
import { exact, identifier, integer, record } from '../../values/index.js';

export function parseSpaceInput(value: unknown, policy: RetrievalPolicy): SpaceInput {
  const data = record(value);
  exact(data, ['memoryId']);
  return { memoryId: identifier(data.memoryId, policy.maxIdBytes) };
}

export function parseEntryInput(value: unknown, policy: RetrievalPolicy): EntryInput {
  const data = record(value);
  exact(data, ['memoryId', 'entryId']);
  return {
    memoryId: identifier(data.memoryId, policy.maxIdBytes),
    entryId: identifier(data.entryId, policy.maxIdBytes),
  };
}

export function parseReceiptInput(value: unknown, policy: RetrievalPolicy): ReceiptInput {
  const data = record(value);
  exact(data, ['memoryId', 'requestId']);
  return {
    memoryId: identifier(data.memoryId, policy.maxIdBytes),
    requestId: identifier(data.requestId, policy.maxIdBytes),
  };
}

export function parseListInput(
  value: unknown,
  policy: RetrievalPolicy
): Required<Pick<ListInput, 'memoryId' | 'limit'>> & Pick<ListInput, 'cursor'> {
  const data = record(value);
  exact(data, ['memoryId', 'limit', 'cursor']);
  return {
    memoryId: identifier(data.memoryId, policy.maxIdBytes),
    limit: integer(data.limit ?? DEFAULT_ENTRY_LIST_LIMIT),
    ...(data.cursor === undefined
      ? {}
      : { cursor: identifier(data.cursor, policy.maxCursorBytes) }),
  };
}
