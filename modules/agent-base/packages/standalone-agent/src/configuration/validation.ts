import { AgentBaseStandaloneError } from '../errors.js';
import type { UnknownRecord } from './types/validation.js';

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!isUnknownRecord(value)) {
    throw new AgentBaseStandaloneError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AgentBaseStandaloneError(`${label} must be a plain object.`);
  }
  return value;
}

export function assertExactKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  label: string
): void {
  const unexpected = Reflect.ownKeys(value).find(
    (key) => typeof key !== 'string' || !allowed.includes(key)
  );
  if (unexpected !== undefined) {
    throw new AgentBaseStandaloneError(
      `${label} contains unsupported field "${String(unexpected)}".`
    );
  }
}

export function readOptionalDataField(record: UnknownRecord, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!descriptor.enumerable || !('value' in descriptor)) {
    throw new AgentBaseStandaloneError(`${label} must be an enumerable data field.`);
  }
  return descriptor.value;
}

export function assertDataFields(value: UnknownRecord, label: string): void {
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property === undefined || !property.enumerable || !('value' in property)) {
      throw new AgentBaseStandaloneError(`${label} must contain enumerable data fields.`);
    }
  }
}

export const EXECUTION_TIMEOUT_KEYS = Object.freeze(['timeoutMilliseconds']);

export function readTimeoutField(record: UnknownRecord, key: string, label: string): number | null {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    throw new AgentBaseStandaloneError(`${label} must be an enumerable data field.`);
  }
  const value: unknown = descriptor.value as unknown;
  if (value !== null && typeof value !== 'number') {
    throw new AgentBaseStandaloneError(`${label} must be null or a number.`);
  }
  return value;
}
