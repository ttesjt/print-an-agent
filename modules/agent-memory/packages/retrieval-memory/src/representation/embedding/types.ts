import type { TextEmbeddingCapability } from '@print-an-agent/model-invocation-core';

export interface EmbeddingResolver {
  resolve(
    ref: string,
    signal: AbortSignal
  ): TextEmbeddingCapability | Promise<TextEmbeddingCapability>;
}
