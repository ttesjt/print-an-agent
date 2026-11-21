import type { TokenCounterDescriptor } from './types/counter.js';
import type { TokenCountResult, TokenMeasurement } from './types/measurement.js';
import { TokenMeasurementError } from './errors.js';
import {
  parseMeasurementAccuracy,
  parseMeasurementReference,
  parseMeasurementScope,
  readClosedRecord,
} from './validation.js';

const RESULT_KEYS = Object.freeze(['tokens', 'accuracy']);
const MEASUREMENT_KEYS = Object.freeze([
  ...RESULT_KEYS,
  'measurementRef',
  'inputProtocolRef',
  'scope',
]);

function parseCountResult(record: Readonly<Record<string, unknown>>): TokenCountResult {
  const code = 'TOKEN_MEASUREMENT_RESULT_INVALID';
  if (
    typeof record.tokens !== 'number' ||
    !Number.isSafeInteger(record.tokens) ||
    record.tokens < 0
  ) {
    throw new TokenMeasurementError(code, 'Token count must be a non-negative safe integer.');
  }
  return {
    tokens: record.tokens,
    accuracy: parseMeasurementAccuracy(record.accuracy, code),
  };
}

export function bindTokenMeasurement(
  input: unknown,
  descriptor: TokenCounterDescriptor
): TokenMeasurement {
  const result = parseCountResult(
    readClosedRecord(input, RESULT_KEYS, 'TOKEN_MEASUREMENT_RESULT_INVALID')
  );
  return Object.freeze({
    ...result,
    measurementRef: descriptor.measurementRef,
    inputProtocolRef: descriptor.inputProtocolRef,
    scope: descriptor.scope,
  });
}

/** Validates detached/stored measurements without assuming they came from an official factory. */
export function parseTokenMeasurement(input: unknown): TokenMeasurement {
  const code = 'TOKEN_MEASUREMENT_RESULT_INVALID';
  const record = readClosedRecord(input, MEASUREMENT_KEYS, code);
  return Object.freeze({
    ...parseCountResult(record),
    measurementRef: parseMeasurementReference(record.measurementRef, code),
    inputProtocolRef: parseMeasurementReference(record.inputProtocolRef, code),
    scope: parseMeasurementScope(record.scope, code),
  });
}
