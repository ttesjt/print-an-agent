import type { ReadContextResult } from './types/result.js';
import type { ContextCandidate } from './types/input.js';
import type { RetrievalHit } from '../types/search.js';
import { fail } from '../errors.js';
import { equal, jsonSnapshot } from '../values/index.js';
import type { ContextMeter } from './types/meter.js';

export async function finalizeContext(
  candidate: ContextCandidate,
  selection: readonly RetrievalHit[],
  meter: ContextMeter,
  signal: AbortSignal
): Promise<ReadContextResult> {
  const { input, result } = candidate;
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
}
