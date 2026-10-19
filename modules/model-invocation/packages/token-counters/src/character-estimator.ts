import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  TOKEN_MEASUREMENT_ACCURACY,
  TokenMeasurementError,
  type TextTokenInput,
  type TokenCounter,
} from '@ta-agent/model-invocation-core';
import { readCounterOptions } from './counter-options.js';

export const DEFAULT_CHARACTERS_PER_TOKEN = 4;

export interface CharacterTokenEstimatorOptions {
  readonly charactersPerToken?: number;
}

export function parseCharactersPerToken(options: unknown): number {
  const record = readCounterOptions(options, ['charactersPerToken']);
  const ratio = Object.hasOwn(record, 'charactersPerToken')
    ? record.charactersPerToken
    : DEFAULT_CHARACTERS_PER_TOKEN;
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) {
    throw new TokenMeasurementError(
      'TOKEN_MEASUREMENT_BINDING_INVALID',
      'charactersPerToken must be finite and positive.'
    );
  }
  return ratio;
}

/** UTF-16 length heuristic, not a tokenizer or provider-specific context/billing count. */
export function createCharacterTokenEstimator(
  options: CharacterTokenEstimatorOptions = {}
): TokenCounter<TextTokenInput> {
  const ratio = parseCharactersPerToken(options);
  return createTokenCounter({
    measurementRef: `estimate:utf16-code-units:ceil:per-token:${String(ratio).replace('+', '')}`,
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: (input, signal) => {
      signal.throwIfAborted();
      return Promise.resolve({
        tokens: Math.ceil(input.text.length / ratio),
        accuracy: TOKEN_MEASUREMENT_ACCURACY.ESTIMATED,
      });
    },
  });
}
