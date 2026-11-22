import type { ContextCandidate } from './types/input.js';
import type { RetrievalHit } from '../types/search.js';
import { assertNotAborted } from '../errors.js';
import type { ContextMeter } from './types/meter.js';

export async function selectContextChunks(
  candidate: ContextCandidate,
  meter: ContextMeter,
  signal: AbortSignal
): Promise<readonly RetrievalHit[]> {
  const { input, result } = candidate;
  const selected: RetrievalHit[] = [];
  for (const hit of result.hits) {
    assertNotAborted(signal);
    if (selected.length >= input.maxChunks) break;
    const rendered = await meter.render(input, [...selected, hit], signal);
    if (input.maxTokens === null || rendered.measurement!.tokens <= input.maxTokens)
      selected.push(hit);
  }
  return selected;
}
