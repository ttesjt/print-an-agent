import type { RetrievalSpace, SearchResult } from '../contracts/data.js';
import { RETRIEVAL_PROTOCOL_POLICY } from '../config.js';
import { fail } from '../errors.js';
import { entryBody } from './input.js';
import { equal, identifier, integer, record, text } from './json.js';
import { parseRetrievalSpace } from './state.js';
export function parseSearchResult(
  value: SearchResult,
  expected: RetrievalSpace,
  topK: number
): SearchResult {
  record(value);
  const space = parseRetrievalSpace(value.space);
  if (
    space.memoryId !== expected.memoryId ||
    space.revision !== expected.revision ||
    !equal(space.index, expected.index)
  )
    fail('REVISION_CONFLICT', 'Search used a different representation configuration.');
  const ids = new Set<string>();
  if (value.hits.length > topK) fail('SEARCH_FAILED', 'Backend exceeded requested hit count.');
  const hits = value.hits.map((hit) => {
    const { source } = entryBody(
      { content: hit.text, source: hit.source },
      RETRIEVAL_PROTOCOL_POLICY
    );
    identifier(hit.entryId);
    integer(hit.entryRevision);
    identifier(hit.chunkId);
    identifier(hit.representationId);
    integer(hit.ordinal, 0);
    text(hit.text, true);
    identifier(hit.ranking.strategyRef);
    if (
      hit.memoryId !== space.memoryId ||
      hit.generationId !== space.index.generationId ||
      hit.ranking.metricRef !== space.index.metricRef ||
      hit.ranking.order !== 'ascending' ||
      !Number.isFinite(hit.ranking.value) ||
      ids.has(hit.chunkId)
    )
      fail('SEARCH_FAILED', 'Invalid search hit evidence.');
    if (hit.span !== null && integer(hit.span.end) - integer(hit.span.start, 0) !== hit.text.length)
      fail('SEARCH_FAILED', 'Invalid search source span.');
    ids.add(hit.chunkId);
    return { ...structuredClone(hit), source };
  });
  return { space, hits };
}
