import type { MemoryItem, RenderOptions } from '../types/document.js';
import type { TextTokenInput, TokenCounter } from '@print-an-agent/model-invocation-core';

export interface MemoryRenderer {
  /** Stable implementation identity; options are also included in measurement identity. */
  readonly id: string;
  render(
    items: readonly MemoryItem[],
    options: RenderOptions,
    signal: AbortSignal
  ): Promise<string>;
}

export type MemoryCounterResolver = (
  measurementRef: string,
  signal: AbortSignal
) => TokenCounter<TextTokenInput> | Promise<TokenCounter<TextTokenInput>>;

export type MemoryMeterOptions = Readonly<{
  renderer?: MemoryRenderer;
  /** Completed results only: one request never owns another request's cancellation. */
  maxCacheEntries?: number;
}> &
  (
    | Readonly<{ counter: TokenCounter<TextTokenInput>; resolveCounter?: never }>
    | Readonly<{ counter?: never; resolveCounter: MemoryCounterResolver }>
  );
