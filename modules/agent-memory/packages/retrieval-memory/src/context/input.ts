import type { ResolvedContextInput } from '../contracts/context.js';
import type { RetrievalPolicy } from '../config.js';
import { RETRIEVAL_DEFAULTS } from '../config.js';
import { exact, identifier, integer, record, text } from '../validation/json.js';
import { parseSearchInput } from '../validation/queries.js';
export function parseContextInput(
  value: unknown,
  policy: RetrievalPolicy,
  rendererRef: string
): ResolvedContextInput {
  const input = record(value);
  exact(input, [
    'memoryId',
    'query',
    'filter',
    'candidates',
    'maxChunks',
    'maxTokens',
    'rendererRef',
    'separator',
  ]);
  const candidates = integer(input.candidates ?? RETRIEVAL_DEFAULTS.contextCandidates);
  const search = parseSearchInput(
    {
      memoryId: input.memoryId,
      query: input.query,
      topK: candidates,
      ...(input.filter === undefined ? {} : { filter: input.filter }),
    },
    policy
  );
  return {
    memoryId: search.memoryId,
    query: search.query,
    ...(search.filter === undefined ? {} : { filter: search.filter }),
    candidates,
    maxChunks: integer(input.maxChunks ?? RETRIEVAL_DEFAULTS.contextMaxChunks),
    maxTokens:
      input.maxTokens === null
        ? null
        : integer(input.maxTokens ?? RETRIEVAL_DEFAULTS.contextMaxTokens, 0),
    rendererRef: identifier(input.rendererRef ?? rendererRef),
    separator: text(input.separator ?? RETRIEVAL_DEFAULTS.separator),
  };
}
