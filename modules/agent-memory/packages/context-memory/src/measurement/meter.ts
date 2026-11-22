import {
  bindTextTokenCounter,
  requireTokenMeasurement,
} from '@print-an-agent/model-invocation-core';
import type {
  TextTokenInput,
  TokenCounter,
  TokenMeasurement,
} from '@print-an-agent/model-invocation-core';
import type { MemoryConfig, MemoryItem, MemoryMeasurement } from '../types/document.js';
import { resolveMemoryConfig, parseMemoryItems } from '../document/index.js';
import { digestValue, identity, integer } from '../values/index.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { DEFAULT_MEMORY_RENDERER } from './default-renderer.js';
import type { MemoryCounterResolver, MemoryMeterOptions } from './types.js';

export const DEFAULT_MEASUREMENT_CACHE_ENTRIES = 128;

export class MemoryMeter {
  readonly #resolveCounter: MemoryCounterResolver;
  readonly #renderer;
  readonly #maxCacheEntries;
  readonly #cache = new Map<string, TokenMeasurement>();
  constructor(options: MemoryMeterOptions) {
    if (options.counter !== undefined && options.resolveCounter === undefined) {
      const counter = bindTextTokenCounter(options.counter);
      this.#resolveCounter = () => counter;
    } else if (options.counter === undefined && typeof options.resolveCounter === 'function') {
      this.#resolveCounter = options.resolveCounter;
    } else
      throw new ContextMemoryError(
        'CONFIG_INVALID',
        'Provide either a counter or an explicit counter resolver.'
      );
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
    const counter = await this.#resolve(config.measurementRef, signal);
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
        ...(await this.#count(item.content, counter, signal)),
      });
    const total = await this.#count(text, counter, signal);
    return {
      text,
      measurement: {
        ...total,
        rendererRef: this.#renderer.id,
        renderDigest: digestValue(config.render),
        itemsDigest: digestValue(items),
        itemTokenCounts,
      },
    };
  }

  async #resolve(ref: string, signal: AbortSignal): Promise<TokenCounter<TextTokenInput>> {
    try {
      const counter = bindTextTokenCounter(await this.#resolveCounter(ref, signal));
      assertMemoryNotAborted(signal);
      if (counter.descriptor.measurementRef !== ref)
        throw new ContextMemoryError(
          'TOKENIZER_UNAVAILABLE',
          'Requested measurement identity is not available.'
        );
      return counter;
    } catch (cause: unknown) {
      assertMemoryNotAborted(signal);
      if (cause instanceof ContextMemoryError) throw cause;
      throw new ContextMemoryError('TOKENIZER_UNAVAILABLE', 'Counter resolution failed.', {
        cause,
      });
    }
  }

  async #count(
    text: string,
    counter: TokenCounter<TextTokenInput>,
    signal: AbortSignal
  ): Promise<TokenMeasurement> {
    assertMemoryNotAborted(signal);
    const key = digestValue({ descriptor: counter.descriptor, text });
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return cached;
    }
    let result: TokenMeasurement;
    try {
      result = requireTokenMeasurement(await counter.measure({ kind: 'text', text }, signal), {
        measurementRef: counter.descriptor.measurementRef,
        inputProtocolRef: counter.descriptor.inputProtocolRef,
        scope: counter.descriptor.scope,
      });
      assertMemoryNotAborted(signal);
    } catch (cause: unknown) {
      assertMemoryNotAborted(signal);
      if (cause instanceof ContextMemoryError) throw cause;
      throw new ContextMemoryError('TOKENIZER_UNAVAILABLE', 'Token measurement failed.', { cause });
    }
    if (this.#maxCacheEntries > 0) {
      this.#cache.set(key, result);
      if (this.#cache.size > this.#maxCacheEntries) {
        const oldest = this.#cache.keys().next();
        if (!oldest.done) this.#cache.delete(oldest.value);
      }
    }
    return result;
  }
}
