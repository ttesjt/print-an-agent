import { DEFAULT_SEARCH_TOP_K } from './defaults.js';
import type { SearchInput } from './types/input.js';
import type { RetrievalPolicy } from '../../policy/index.js';
import { fail } from '../../errors.js';
import { exact, identifier, integer, record, text } from '../../values/index.js';
import { parseMetadataFilter } from '../../filters/index.js';

export function parseSearchInput(
  value: unknown,
  policy: RetrievalPolicy
): SearchInput & { readonly topK: number } {
  const data = record(value);
  exact(data, ['memoryId', 'query', 'filter', 'topK']);
  const topK = integer(data.topK ?? DEFAULT_SEARCH_TOP_K);
  if (policy.maxTopK !== null && topK > policy.maxTopK)
    fail('INPUT_INVALID', 'Search size exceeds policy.');
  return {
    memoryId: identifier(data.memoryId, policy.maxIdBytes),
    query: text(data.query, true),
    topK,
    ...(data.filter === undefined ? {} : { filter: parseMetadataFilter(data.filter, policy) }),
  };
}
