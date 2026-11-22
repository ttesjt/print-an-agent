import type { ContextCandidate } from './input.js';
import type { ReadContextResult } from './result.js';
import type { RetrievalHit } from '../../types/search.js';

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
