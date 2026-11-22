import { isPromise } from 'node:util/types';
import {
  bindTextTokenCounter,
  TokenMeasurementError,
  type TokenCounter,
  type TextTokenInput,
} from '@print-an-agent/model-invocation-core';
import { createCharacterTokenEstimator } from '../character-estimator.js';
import { createTiktokenTextCounter } from '../tiktoken/index.js';
import { defineTextTokenCounterConfig } from './define.js';
import { TEXT_TOKEN_COUNTER_KIND, type TextTokenCounterConfigInput } from './options.js';

/** Host preloads capabilities; lookup selects an existing synchronous binding. */
export type TextTokenCounterReferenceResolver = (
  measurementRef: string
) => TokenCounter<TextTokenInput>;

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
