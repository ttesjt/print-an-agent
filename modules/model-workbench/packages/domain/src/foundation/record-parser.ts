import { InvalidWorkbenchValueError } from './errors.js';

export function parseClosedRecord(
  input: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = []
): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidWorkbenchValueError(path, 'must be an object');
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidWorkbenchValueError(path, 'must be a plain object');
  }
  const record = input as Readonly<Record<string, unknown>>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new InvalidWorkbenchValueError(`${path}.${key}`, 'is not allowed');
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw new InvalidWorkbenchValueError(`${path}.${key}`, 'is required');
    }
  }
  return record;
}

export function parseLiteral<TValue extends string>(
  input: unknown,
  expected: TValue,
  path: string
): TValue {
  if (input !== expected) {
    throw new InvalidWorkbenchValueError(path, `must equal "${expected}"`);
  }
  return expected;
}

export function parseStringUnion<TValue extends string>(
  input: unknown,
  values: ReadonlySet<TValue>,
  path: string
): TValue {
  if (typeof input !== 'string' || !values.has(input as TValue)) {
    throw new InvalidWorkbenchValueError(path, 'contains an unsupported value');
  }
  return input as TValue;
}
