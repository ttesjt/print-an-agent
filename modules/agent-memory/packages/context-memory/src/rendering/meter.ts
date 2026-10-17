import type { MemoryConfig, MemoryItem, MemoryMeasurement } from '../contracts/document.js';
import type { MemoryRenderer, TokenCounter } from '../contracts/ports.js';
import { resolveMemoryConfig } from '../config/parse.js';
import { digestValue } from '../domain/digest.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { parseMemoryItems } from '../validation/items.js';
import { identity, integer } from '../validation/value.js';
import { DEFAULT_MEMORY_RENDERER } from './default-renderer.js';

export const DEFAULT_MEASUREMENT_CACHE_ENTRIES = 128;
export interface MemoryMeterOptions {
  readonly counter: TokenCounter;
  readonly renderer?: MemoryRenderer;
  /** Completed count cache only: one request never owns another request's cancellation. */
  readonly maxCacheEntries?: number;
}
export class MemoryMeter {
  readonly #counter;
  readonly #renderer;
  readonly #maxCacheEntries;
  readonly #cache = new Map<string, number>();
  constructor(options: MemoryMeterOptions) {
    this.#counter = options.counter;
    this.#renderer = options.renderer ?? DEFAULT_MEMORY_RENDERER;
    identity(this.#renderer.id, 'renderer identity');
    this.#maxCacheEntries = integer(
      options.maxCacheEntries ?? DEFAULT_MEASUREMENT_CACHE_ENTRIES,
      'maxCacheEntries'
    );
  }
  async measure(
    itemsInput: readonly MemoryItem[],
    configInput: MemoryConfig,
    signal: AbortSignal = new AbortController().signal
  ): Promise<{ text: string; measurement: MemoryMeasurement }> {
    assertMemoryNotAborted(signal);
    const items = parseMemoryItems(itemsInput);
    const config = resolveMemoryConfig(configInput);
    if (config.render.format === 'custom' && this.#renderer.id !== config.render.rendererRef)
      throw new ContextMemoryError('CONFIG_INVALID', 'Custom renderer identity is not available.');
    const text = await this.#renderer.render(items, config.render, signal);
    assertMemoryNotAborted(signal);
    if (typeof text !== 'string')
      throw new ContextMemoryError('CONFIG_INVALID', 'Renderer must return text.');
    const itemTokenCounts = [];
    for (const item of items)
      itemTokenCounts.push({
        itemId: item.id,
        contentDigest: digestValue(item.content),
        tokenCount: await this.#count(item.content, config.tokenizerRef, signal),
      });
    const tokenCount = await this.#count(text, config.tokenizerRef, signal);
    return {
      text,
      measurement: {
        tokenizerRef: config.tokenizerRef,
        rendererRef: this.#renderer.id,
        renderDigest: digestValue(config.render),
        itemsDigest: digestValue(items),
        tokenCount,
        itemTokenCounts,
      },
    };
  }
  async #count(text: string, tokenizerRef: string, signal: AbortSignal): Promise<number> {
    assertMemoryNotAborted(signal);
    const key = digestValue({ tokenizerRef, text });
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return cached;
    }
    let count: number;
    try {
      count = integer(await this.#counter.count(text, tokenizerRef, signal), 'token count');
      assertMemoryNotAborted(signal);
    } catch (cause) {
      assertMemoryNotAborted(signal);
      if (cause instanceof ContextMemoryError) throw cause;
      throw new ContextMemoryError('TOKENIZER_UNAVAILABLE', 'Token counting failed.', { cause });
    }
    if (this.#maxCacheEntries > 0) {
      this.#cache.set(key, count);
      if (this.#cache.size > this.#maxCacheEntries) {
        const oldest = this.#cache.keys().next();
        if (!oldest.done) this.#cache.delete(oldest.value);
      }
    }
    return count;
  }
}
