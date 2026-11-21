import { ModelInvocationError } from '../errors.js';
import {
  readPlainModelRecord,
  assertModelRecordKeys,
  readModelDataField,
} from '../record-validation.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

export function invalid(message: string, cause?: unknown): ModelInvocationError {
  return new ModelInvocationError(
    'MODEL_EXECUTION_PROVENANCE_INVALID',
    message,
    cause === undefined ? undefined : { cause }
  );
}
export function requirePlainRecord(value: unknown, label: string): UnknownRecord {
  return readPlainModelRecord(value, label, invalid, 'plain JSON object');
}
export function assertExactKeys(
  record: UnknownRecord,
  expected: readonly string[],
  label: string
): void {
  assertModelRecordKeys(record, expected, () =>
    invalid(`${label} has unsupported or missing fields.`)
  );
}
export function requireDataProperty(record: UnknownRecord, key: string, label: string): unknown {
  return readModelDataField(record, key, () =>
    invalid(`${label} must be an enumerable data property.`)
  );
}
