import { AgentRequestError } from '../../../errors.js';

type UnknownRecord = Record<string, unknown>;

export function invalidRecord(message: string, cause?: unknown): AgentRequestError {
  return new AgentRequestError(
    'REQUEST_REPLAY_RECORD_INVALID',
    message,
    cause === undefined ? undefined : { cause }
  );
}

export function requireRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRecord(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

export function assertKeys(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  label: string
): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(record);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw invalidRecord(`${label} has unsupported or missing fields.`);
  }
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalidRecord(`${label} must be a string.`);
  return value;
}

export function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidRecord(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

export function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidRecord(`${label} must be a finite number.`);
  }
  return value;
}

export function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : requireNonNegativeInteger(value, label);
}

export function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : requireFiniteNumber(value, label);
}
