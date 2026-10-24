import type {
  EntryInput,
  ListInput,
  ReceiptInput,
  SearchInput,
  SpaceInput,
} from '../contracts/inputs.js';
import type { RetrievalPolicy } from '../config.js';
import { RETRIEVAL_DEFAULTS } from '../config.js';
import { fail } from '../errors.js';
import { exact, identifier, integer, record, text } from './json.js';
import { parseMetadataFilter } from './filters.js';
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
    limit: integer(data.limit ?? RETRIEVAL_DEFAULTS.listLimit),
    ...(data.cursor === undefined
      ? {}
      : { cursor: identifier(data.cursor, policy.maxCursorBytes) }),
  };
}
export function parseSearchInput(
  value: unknown,
  policy: RetrievalPolicy
): SearchInput & { readonly topK: number } {
  const data = record(value);
  exact(data, ['memoryId', 'query', 'filter', 'topK']);
  const topK = integer(data.topK ?? RETRIEVAL_DEFAULTS.topK);
  if (policy.maxTopK !== null && topK > policy.maxTopK)
    fail('INPUT_INVALID', 'Search size exceeds policy.');
  return {
    memoryId: identifier(data.memoryId, policy.maxIdBytes),
    query: text(data.query, true),
    topK,
    ...(data.filter === undefined ? {} : { filter: parseMetadataFilter(data.filter, policy) }),
  };
}
