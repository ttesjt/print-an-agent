import { ModelInvocationError } from '../errors.js';
import {
  readPlainModelRecord,
  assertModelRecordKeys,
  readModelDataField,
} from '../record-validation.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

export function invalid(message: string): ModelInvocationError {
  return new ModelInvocationError('MODEL_RUNTIME_PROTOCOL_INVALID', message);
}
export function requirePlainRecord(value: unknown): UnknownRecord {
  return readPlainModelRecord(value, 'Model interaction event', invalid);
}
export function requireDataProperty(record: UnknownRecord, key: string): unknown {
  return readModelDataField(record, key, () =>
    invalid(`Model interaction event ${key} must be an enumerable data property.`)
  );
}
export function assertExactKeys(record: UnknownRecord, expected: readonly string[]): void {
  assertModelRecordKeys(record, expected, () =>
    invalid('Model interaction event contains unsupported or missing fields.')
  );
}
export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw invalid(`Model interaction event ${name} must be a string.`);
  return value;
}

export function requireCount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(`Model interaction event ${name} must be a non-negative safe integer.`);
  }
  return value;
}
