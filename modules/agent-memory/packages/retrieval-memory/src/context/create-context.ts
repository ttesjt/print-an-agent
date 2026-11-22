import { selectContextChunks } from './selection.js';
import { finalizeContext } from './finalize.js';
import type { ContextCandidate } from './types/input.js';
import type { RetrievalContextOptions } from './types/rendering.js';
import type { RetrievalQueryOperations } from '../queries/index.js';
import { defineRetrievalPolicy } from '../policy/index.js';
import type { RetrievalPolicy } from '../policy/index.js';
import { fail } from '../errors.js';
import { jsonSnapshot } from '../values/index.js';
import { parseSearchResult } from '../queries/index.js';
import { parseContextInput } from './input.js';
import { createContextMeter } from './meter.js';
import { DEFAULT_RETRIEVAL_RENDERER } from './renderer.js';
import type { RetrievalContextOperations } from './types/operations.js';

export function createRetrievalContext(
  queries: Pick<RetrievalQueryOperations, 'search'>,
  options: RetrievalContextOptions = {},
  policyInput: Partial<RetrievalPolicy> = {}
): RetrievalContextOperations {
  const policy = defineRetrievalPolicy(policyInput);
  const meter = createContextMeter(options);
  const defaultRendererRef = options.defaultRendererRef ?? DEFAULT_RETRIEVAL_RENDERER.ref;
  function validate(candidate: ContextCandidate) {
    jsonSnapshot(candidate);
    const input = parseContextInput(candidate.input, policy, defaultRendererRef);
    if (candidate.result.space.memoryId !== input.memoryId)
      fail('SEARCH_FAILED', 'Context candidate scope mismatch.');
    const result = parseSearchResult(candidate.result, candidate.result.space, input.candidates);
    meter.requireCounter(input.maxTokens);
    return { input, result };
  }
  const operations: RetrievalContextOperations = {
    async search(value, signal) {
      const input = parseContextInput(value, policy, defaultRendererRef);
      meter.requireCounter(input.maxTokens);
      const result = await queries.search(
        {
          memoryId: input.memoryId,
          query: input.query,
          topK: input.candidates,
          ...(input.filter === undefined ? {} : { filter: input.filter }),
        },
        signal
      );
      return { input, result };
    },
    async select(candidate, signal) {
      return selectContextChunks(validate(candidate), meter, signal);
    },
    async finalize(candidate, selection, signal) {
      return finalizeContext(validate(candidate), selection, meter, signal);
    },
    async read(input, signal) {
      const candidate = await operations.search(input, signal);
      return operations.finalize(candidate, await operations.select(candidate, signal), signal);
    },
  };
  return Object.freeze(operations);
}
