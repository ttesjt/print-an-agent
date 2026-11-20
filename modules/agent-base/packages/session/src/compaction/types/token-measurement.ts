import type { TextTokenInput, TokenCounter } from '@print-an-agent/model-invocation-core';

export interface CompactionMeasurementResources {
  readonly tokenCounter?: TokenCounter<TextTokenInput>;
  readonly resolveTokenCounter?: (signal: AbortSignal) => Promise<TokenCounter<TextTokenInput>>;
}
