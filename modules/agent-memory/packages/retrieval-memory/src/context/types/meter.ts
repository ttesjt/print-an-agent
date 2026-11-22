import type { TokenMeasurement } from '@print-an-agent/model-invocation-core';
import type { ResolvedContextInput } from './input.js';
import type { RetrievalHit } from '../../types/search.js';

export interface ContextMeter {
  requireCounter(maxTokens: number | null): void;
  render(
    input: ResolvedContextInput,
    hits: readonly RetrievalHit[],
    signal: AbortSignal
  ): Promise<{ text: string; measurement: TokenMeasurement | null }>;
}
