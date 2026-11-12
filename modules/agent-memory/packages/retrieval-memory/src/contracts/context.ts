import type {
  TextTokenInput,
  TokenCounter,
  TokenMeasurement,
} from '@print-an-agent/model-invocation-core';
import type { RetrievalHit, SearchResult, RetrievalSource } from './data.js';
import type { SearchInput } from './inputs.js';
export interface ReadContextInput extends Omit<SearchInput, 'topK'> {
  readonly candidates?: number;
  readonly maxChunks?: number;
  readonly maxTokens?: number | null;
  readonly rendererRef?: string;
  readonly separator?: string;
}
export interface ResolvedContextInput extends ReadContextInput {
  readonly candidates: number;
  readonly maxChunks: number;
  readonly maxTokens: number | null;
  readonly rendererRef: string;
  readonly separator: string;
}
export interface RetrievalContextRenderer {
  readonly ref: string;
  render(
    input: { readonly hits: readonly RetrievalHit[]; readonly separator: string },
    signal: AbortSignal
  ): string | Promise<string>;
}
export interface RetrievalRendererResolver {
  resolve(
    ref: string,
    signal: AbortSignal
  ): RetrievalContextRenderer | Promise<RetrievalContextRenderer>;
}
export interface RetrievalContextOptions {
  readonly counter?: TokenCounter<TextTokenInput>;
  readonly renderers?: RetrievalRendererResolver;
  readonly defaultRendererRef?: string;
}
export interface ContextCandidate {
  readonly input: ResolvedContextInput;
  readonly result: SearchResult;
}
export interface RetrievalCitation {
  readonly number: number;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly chunkId: string;
  readonly representationId: string;
  readonly source: RetrievalSource | null;
}
export interface ReadContextResult extends SearchResult {
  readonly text: string;
  readonly citations: readonly RetrievalCitation[];
  readonly rendererRef: string;
  readonly measurement: TokenMeasurement | null;
  readonly outcome: 'selected' | 'empty' | 'no-chunk-fits';
}
