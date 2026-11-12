import { InvalidWorkbenchValueError } from '@print-an-agent/workbench-domain';

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
