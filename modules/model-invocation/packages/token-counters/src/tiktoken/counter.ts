import {
  TIKTOKEN_ENCODING,
  parseTiktokenEncoding,
  type TiktokenTextCounterOptions,
} from './encoding.js';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  TOKEN_MEASUREMENT_ACCURACY,
  type TextTokenInput,
  type TokenCounter,
} from '@print-an-agent/model-invocation-core';
import type { Tiktoken } from 'js-tiktoken/lite';
import { readCounterOptions } from '../option-record.js';

const TIKTOKEN_IMPLEMENTATION_REF = 'js-tiktoken:1.0.21';

/** Loads only the selected bundled vocabulary on first measurement; never downloads ranks. */
export function createTiktokenTextCounter(
  options: TiktokenTextCounterOptions
): TokenCounter<TextTokenInput> {
  const encoding = parseTiktokenEncoding(readCounterOptions(options, ['encoding']).encoding);
  let tokenizer: Promise<Tiktoken> | undefined;
  async function load(): Promise<Tiktoken> {
    const { Tiktoken } = await import('js-tiktoken/lite');
    const ranks =
      encoding === TIKTOKEN_ENCODING.CL100K_BASE
        ? await import('js-tiktoken/ranks/cl100k_base')
        : await import('js-tiktoken/ranks/o200k_base');
    return new Tiktoken(ranks.default);
  }
  return createTokenCounter({
    measurementRef: `${TIKTOKEN_IMPLEMENTATION_REF}:${encoding}:ordinary-text`,
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: async (input, signal) => {
      signal.throwIfAborted();
      // Initialization belongs to the counter, not an individual caller's cancellation.
      tokenizer ??= load();
      const ready = await tokenizer;
      signal.throwIfAborted();
      const tokens = ready.encode(input.text, [], []).length;
      signal.throwIfAborted();
      return { tokens, accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT };
    },
  });
}
