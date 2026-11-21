import type { TokenMeasurement, TokenMeasurementRequirements } from './types/measurement.js';
import { TokenMeasurementError } from './errors.js';
import { parseTokenMeasurement } from './result.js';
import {
  parseMeasurementAccuracy,
  parseMeasurementReference,
  parseMeasurementScope,
  readClosedRecord,
} from './validation.js';

const REQUIREMENT_KEYS = Object.freeze(['measurementRef', 'inputProtocolRef', 'scope', 'accuracy']);

/** Checks identity and semantics only; budgets and publication authority belong to consumers. */
export function requireTokenMeasurement(
  input: unknown,
  requirements: TokenMeasurementRequirements
): TokenMeasurement {
  const measurement = parseTokenMeasurement(input);
  const code = 'TOKEN_MEASUREMENT_REQUIREMENT_INVALID';
  const record = readClosedRecord(requirements, REQUIREMENT_KEYS, code);
  const normalized: TokenMeasurementRequirements = {
    ...(Object.hasOwn(record, 'measurementRef')
      ? { measurementRef: parseMeasurementReference(record.measurementRef, code) }
      : {}),
    ...(Object.hasOwn(record, 'inputProtocolRef')
      ? { inputProtocolRef: parseMeasurementReference(record.inputProtocolRef, code) }
      : {}),
    ...(Object.hasOwn(record, 'scope') ? { scope: parseMeasurementScope(record.scope, code) } : {}),
    ...(Object.hasOwn(record, 'accuracy')
      ? { accuracy: parseMeasurementAccuracy(record.accuracy, code) }
      : {}),
  };
  if (
    (normalized.measurementRef !== undefined &&
      normalized.measurementRef !== measurement.measurementRef) ||
    (normalized.inputProtocolRef !== undefined &&
      normalized.inputProtocolRef !== measurement.inputProtocolRef) ||
    (normalized.scope !== undefined && normalized.scope !== measurement.scope) ||
    (normalized.accuracy !== undefined && normalized.accuracy !== measurement.accuracy)
  ) {
    throw new TokenMeasurementError(
      'TOKEN_MEASUREMENT_REQUIREMENT_UNSATISFIED',
      'Measurement does not satisfy the required identity, scope or accuracy.'
    );
  }
  return measurement;
}
