import {
  InvalidWorkbenchValueError,
  parseJsonValue,
  type JsonValue,
} from '@ta-agent/workbench-domain';

import { WorkbenchSetupError } from './errors.js';

export type UnknownRecord = Readonly<Record<string, unknown>>;

export function parseArray(input: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(input)) invalidSetup(path, 'must be an array');
  return input;
}

export function parseClosedRecord(
  input: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = []
): UnknownRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    invalidSetup(path, 'must be an object');
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    invalidSetup(path, 'must be a plain object');
  }
  const record = input as UnknownRecord;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalidSetup(`${path}.${key}`, 'is not allowed');
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) invalidSetup(`${path}.${key}`, 'is required');
  }
  return record;
}

export function parseOptionalMetadata(record: UnknownRecord, path: string): JsonValue | undefined {
  return Object.hasOwn(record, 'metadata')
    ? parseDomainValue(
        () => parseJsonValue(record.metadata, `${path}.metadata`),
        `${path}.metadata`
      )
    : undefined;
}

export function assertUnique<T>(
  values: readonly T[],
  identity: (value: T) => string,
  path: string
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const key = identity(value);
    if (seen.has(key)) {
      invalidSetup(`${path}[${String(index)}]`, `duplicates identity "${key}"`);
    }
    seen.add(key);
  });
}

export function sortBy<T>(values: readonly T[], identity: (value: T) => string): readonly T[] {
  return Object.freeze(
    [...values].sort((left, right) => identity(left).localeCompare(identity(right)))
  );
}

export function parseDomainValue<T>(parser: () => T, path: string): T {
  try {
    return parser();
  } catch (error: unknown) {
    if (error instanceof InvalidWorkbenchValueError) {
      return invalidSetup(path, error.reason, { cause: error });
    }
    throw error;
  }
}

export function invalidSetup(path: string, reason: string, options?: ErrorOptions): never {
  throw new WorkbenchSetupError(path, reason, options);
}
