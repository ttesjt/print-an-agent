import { isPromise } from 'node:util/types';
import {
  bindTextTokenCounter,
  parseTokenMeasurementReference,
  TokenMeasurementError,
  type TokenCounter,
  type TextTokenInput,
} from '@print-an-agent/model-invocation-core';
import { createCharacterTokenEstimator, parseCharactersPerToken } from './character-estimator.js';
import { readCounterOptions } from './counter-options.js';
import {
  createTiktokenTextCounter,
  parseTiktokenEncoding,
  type TiktokenEncoding,
} from './tiktoken-counter.js';

export const TEXT_TOKEN_COUNTER_KIND = Object.freeze({
  TIKTOKEN: 'tiktoken',
  CHARACTER_ESTIMATOR: 'character-estimator',
  REFERENCE: 'reference',
} as const);

export type TextTokenCounterConfigInput =
  | Readonly<{ kind: typeof TEXT_TOKEN_COUNTER_KIND.TIKTOKEN; encoding: TiktokenEncoding }>
  | Readonly<{
      kind: typeof TEXT_TOKEN_COUNTER_KIND.CHARACTER_ESTIMATOR;
      charactersPerToken?: number;
    }>
  | Readonly<{ kind: typeof TEXT_TOKEN_COUNTER_KIND.REFERENCE; measurementRef: string }>;

export type TextTokenCounterConfig =
  | Readonly<{ kind: typeof TEXT_TOKEN_COUNTER_KIND.TIKTOKEN; encoding: TiktokenEncoding }>
  | Readonly<{
      kind: typeof TEXT_TOKEN_COUNTER_KIND.CHARACTER_ESTIMATOR;
      charactersPerToken: number;
    }>
  | Readonly<{ kind: typeof TEXT_TOKEN_COUNTER_KIND.REFERENCE; measurementRef: string }>;

/** Host preloads capabilities. JSON can select a named binding, never instantiate arbitrary code. */
export type TextTokenCounterReferenceResolver = (
  measurementRef: string
) => TokenCounter<TextTokenInput>;

export function defineTextTokenCounterConfig(input: unknown): TextTokenCounterConfig {
  const record = readCounterOptions(input, [
    'kind',
    'encoding',
    'charactersPerToken',
    'measurementRef',
  ]);
  switch (record.kind) {
    case TEXT_TOKEN_COUNTER_KIND.TIKTOKEN: {
      readCounterOptions(input, ['kind', 'encoding']);
      return Object.freeze({ kind: record.kind, encoding: parseTiktokenEncoding(record.encoding) });
    }
    case TEXT_TOKEN_COUNTER_KIND.CHARACTER_ESTIMATOR: {
      readCounterOptions(input, ['kind', 'charactersPerToken']);
      const options = Object.hasOwn(record, 'charactersPerToken')
        ? { charactersPerToken: record.charactersPerToken }
        : {};
      return Object.freeze({
        kind: record.kind,
        charactersPerToken: parseCharactersPerToken(options),
      });
    }
    case TEXT_TOKEN_COUNTER_KIND.REFERENCE: {
      readCounterOptions(input, ['kind', 'measurementRef']);
      return Object.freeze({
        kind: record.kind,
        measurementRef: parseTokenMeasurementReference(record.measurementRef),
      });
    }
    default:
      throw new TokenMeasurementError(
        'TOKEN_MEASUREMENT_BINDING_INVALID',
        'Unknown text counter configuration kind.'
      );
  }
}

export function resolveTextTokenCounterConfig(
  input: TextTokenCounterConfigInput,
  resolveReference?: TextTokenCounterReferenceResolver
): TokenCounter<TextTokenInput> {
  const config = defineTextTokenCounterConfig(input);
  switch (config.kind) {
    case TEXT_TOKEN_COUNTER_KIND.TIKTOKEN:
      return createTiktokenTextCounter({ encoding: config.encoding });
    case TEXT_TOKEN_COUNTER_KIND.CHARACTER_ESTIMATOR:
      return createCharacterTokenEstimator({ charactersPerToken: config.charactersPerToken });
    case TEXT_TOKEN_COUNTER_KIND.REFERENCE: {
      if (typeof resolveReference !== 'function')
        throw new TokenMeasurementError(
          'TOKEN_MEASUREMENT_BINDING_INVALID',
          'Named text measurement requires an explicit host resolver.'
        );
      try {
        const resolved: unknown = resolveReference(config.measurementRef);
        if (isPromise(resolved)) {
          // Lookup is synchronous. Observe an invalid async SPI result without assimilating payloads.
          void Promise.prototype.then.call(
            resolved,
            () => undefined,
            () => undefined
          );
          throw new TokenMeasurementError(
            'TOKEN_MEASUREMENT_BINDING_INVALID',
            'Counter references must resolve synchronously to preloaded capabilities.'
          );
        }
        const counter = bindTextTokenCounter(resolved);
        if (counter.descriptor.measurementRef !== config.measurementRef)
          throw new TokenMeasurementError(
            'TOKEN_MEASUREMENT_BINDING_INVALID',
            'Resolved counter does not match the requested measurement identity.'
          );
        return counter;
      } catch (cause: unknown) {
        throw new TokenMeasurementError(
          'TOKEN_MEASUREMENT_BINDING_INVALID',
          'Named text measurement could not be resolved.',
          { cause }
        );
      }
    }
  }
}
