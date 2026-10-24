import type {
  ContextCandidate,
  ReadContextResult,
  RetrievalContextOptions,
} from '../contracts/context.js';
import type { RetrievalHit } from '../contracts/data.js';
import type { RetrievalQueryOperations } from '../domain/queries.js';
import { defineRetrievalPolicy, type RetrievalPolicy } from '../config.js';
import { assertNotAborted, fail } from '../errors.js';
import { equal, jsonSnapshot } from '../validation/json.js';
import { parseSearchResult } from '../validation/results.js';
import { parseContextInput } from './input.js';
import { createContextMeter } from './meter.js';
import { DEFAULT_RETRIEVAL_RENDERER } from './renderer.js';
export interface RetrievalContextOperations {
  search(input: unknown, signal: AbortSignal): Promise<ContextCandidate>;
  select(candidate: ContextCandidate, signal: AbortSignal): Promise<readonly RetrievalHit[]>;
  finalize(
    candidate: ContextCandidate,
    selected: readonly RetrievalHit[],
    signal: AbortSignal
  ): Promise<ReadContextResult>;
  read(input: unknown, signal: AbortSignal): Promise<ReadContextResult>;
}
export function createRetrievalContext(
  queries: RetrievalQueryOperations,
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
      const { input, result } = validate(candidate);
      const selected: RetrievalHit[] = [];
      for (const hit of result.hits) {
        assertNotAborted(signal);
        if (selected.length >= input.maxChunks) break;
        const rendered = await meter.render(input, [...selected, hit], signal);
        if (input.maxTokens === null || rendered.measurement!.tokens <= input.maxTokens)
          selected.push(hit);
      }
      return selected;
    },
    async finalize(candidate, selection, signal) {
      const { input, result } = validate(candidate);
      jsonSnapshot(selection);
      const selected = structuredClone(selection);
      const seen = new Set<string>();
      if (selected.length > input.maxChunks)
        fail('CONTEXT_BUDGET_EXCEEDED', 'Selected chunk count exceeds the requested limit.');
      for (const hit of selected) {
        const source = result.hits.find((candidate) => candidate.chunkId === hit.chunkId);
        if (source === undefined || !equal(source, hit) || seen.has(hit.chunkId))
          fail('SEARCH_FAILED', 'Selected chunks must retain their exact search provenance.');
        seen.add(hit.chunkId);
      }
      const rendered = await meter.render(input, selected, signal);
      if (input.maxTokens !== null && rendered.measurement!.tokens > input.maxTokens)
        fail('CONTEXT_BUDGET_EXCEEDED', 'Rendered context exceeds the exact token budget.');
      return {
        ...rendered,
        rendererRef: input.rendererRef,
        space: result.space,
        hits: selected,
        citations: selected.map((hit, i) => ({
          number: i + 1,
          entryId: hit.entryId,
          entryRevision: hit.entryRevision,
          chunkId: hit.chunkId,
          representationId: hit.representationId,
          source: hit.source,
        })),
        outcome:
          selected.length > 0 ? 'selected' : result.hits.length === 0 ? 'empty' : 'no-chunk-fits',
      };
    },
    async read(input, signal) {
      const candidate = await operations.search(input, signal);
      return operations.finalize(candidate, await operations.select(candidate, signal), signal);
    },
  };
  return Object.freeze(operations);
}
