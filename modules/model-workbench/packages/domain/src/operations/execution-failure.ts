import { InvalidWorkbenchValueError } from '../foundation/errors.js';
import { parseJsonValue, type JsonValue } from '../foundation/json.js';

export interface ExecutionFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly diagnostics?: JsonValue;
}

export function parseExecutionFailure(input: unknown, path = 'failure'): ExecutionFailure {
  const record = parseRecord(input, path);
  assertKeys(record, path, ['code', 'message', 'retryable'], ['diagnostics']);
  if (typeof record.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(record.code)) {
    throw new InvalidWorkbenchValueError(`${path}.code`, 'must be a stable uppercase error code');
  }
  if (
    typeof record.message !== 'string' ||
    record.message.length === 0 ||
    record.message.length > 2_000
  ) {
    throw new InvalidWorkbenchValueError(`${path}.message`, 'must be 1-2000 characters');
  }
  if (typeof record.retryable !== 'boolean') {
    throw new InvalidWorkbenchValueError(`${path}.retryable`, 'must be a boolean');
  }
  return Object.freeze({
    code: record.code,
    message: record.message,
    retryable: record.retryable,
    ...(Object.hasOwn(record, 'diagnostics')
      ? { diagnostics: parseJsonValue(record.diagnostics, `${path}.diagnostics`) }
      : {}),
  });
}

function parseRecord(input: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidWorkbenchValueError(path, 'must be an object');
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidWorkbenchValueError(path, 'must be a plain object');
  }
  return input as Readonly<Record<string, unknown>>;
}

function assertKeys(
  record: Readonly<Record<string, unknown>>,
  path: string,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new InvalidWorkbenchValueError(`${path}.${key}`, 'is not allowed');
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw new InvalidWorkbenchValueError(`${path}.${key}`, 'is required');
    }
  }
}
