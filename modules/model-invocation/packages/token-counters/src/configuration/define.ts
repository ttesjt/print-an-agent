import {
  parseTokenMeasurementReference,
  TokenMeasurementError,
} from '@print-an-agent/model-invocation-core';
import { parseCharactersPerToken } from '../character-estimator.js';
import { parseTiktokenEncoding } from '../tiktoken/index.js';
import { readCounterOptions } from '../option-record.js';
import { TEXT_TOKEN_COUNTER_KIND, type TextTokenCounterConfig } from './options.js';

export function defineTextTokenCounterConfig(input: unknown): TextTokenCounterConfig {
  const record = readCounterOptions(input, [
    'kind',
    'encoding',
    'charactersPerToken',
    'measurementRef',
  ]);
  // Variant validation and normalization must use the same captured view of caller-owned data.
  switch (record.kind) {
    case TEXT_TOKEN_COUNTER_KIND.TIKTOKEN: {
      readCounterOptions(record, ['kind', 'encoding']);
      return Object.freeze({ kind: record.kind, encoding: parseTiktokenEncoding(record.encoding) });
    }
    case TEXT_TOKEN_COUNTER_KIND.CHARACTER_ESTIMATOR: {
      readCounterOptions(record, ['kind', 'charactersPerToken']);
      const options = Object.hasOwn(record, 'charactersPerToken')
        ? { charactersPerToken: record.charactersPerToken }
        : {};
      return Object.freeze({
        kind: record.kind,
        charactersPerToken: parseCharactersPerToken(options),
      });
    }
    case TEXT_TOKEN_COUNTER_KIND.REFERENCE: {
      readCounterOptions(record, ['kind', 'measurementRef']);
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
