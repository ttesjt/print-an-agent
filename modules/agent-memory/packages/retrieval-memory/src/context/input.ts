import {
  DEFAULT_CONTEXT_CANDIDATES,
  DEFAULT_CONTEXT_MAX_CHUNKS,
  DEFAULT_CONTEXT_MAX_TOKENS,
  DEFAULT_CONTEXT_SEPARATOR,
} from './defaults.js';
import type { ResolvedContextInput } from './types/input.js';
import type { RetrievalPolicy } from '../policy/index.js';
import { exact, identifier, integer, record, text } from '../values/index.js';
import { parseSearchInput } from '../queries/index.js';

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
  const candidates = integer(input.candidates ?? DEFAULT_CONTEXT_CANDIDATES);
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
    maxChunks: integer(input.maxChunks ?? DEFAULT_CONTEXT_MAX_CHUNKS),
    maxTokens:
      input.maxTokens === null ? null : integer(input.maxTokens ?? DEFAULT_CONTEXT_MAX_TOKENS, 0),
    rendererRef: identifier(input.rendererRef ?? rendererRef),
    separator: text(input.separator ?? DEFAULT_CONTEXT_SEPARATOR),
  };
}
