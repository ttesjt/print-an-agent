import type { TextTokenInput, TokenCounter } from '@print-an-agent/model-invocation-core';
import type { RetrievalHit } from '../../types/search.js';

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
