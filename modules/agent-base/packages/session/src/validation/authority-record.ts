import { AgentSessionError } from '../errors.js';
import type { AgentSessionErrorCode } from '../types/errors.js';
import { enumerableDataProperty, isPlainRecord } from './data-record.js';

export function invalidAuthority(code: AgentSessionErrorCode = 'SESSION_LIFECYCLE_INVALID'): never {
  throw new AgentSessionError(code, 'Session lifecycle value is invalid.');
}

/** Read descriptors, not properties: untrusted getters must never supply authority. */
export function authorityRecord(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): object {
  if (!isPlainRecord(input)) return invalidAuthority();
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== 'string' || (!required.includes(key) && !optional.includes(key))
    )
  )
    return invalidAuthority();
  for (const key of required) authorityField(input, key);
  for (const key of optional) {
    if (Object.hasOwn(input, key)) authorityField(input, key);
  }
  return input;
}

export function authorityField(input: object, key: string): unknown {
  const descriptor = enumerableDataProperty(input, key);
  if (descriptor === undefined) {
    return invalidAuthority();
  }
  return descriptor.value;
}

export function optionalAuthorityField(input: object, key: string): unknown {
  return Object.hasOwn(input, key) ? authorityField(input, key) : undefined;
}

export function authorityInteger(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    return invalidAuthority();
  }
  return input;
}

/** Normalize structural/proxy/parser failures without leaking native errors at public boundaries. */
export function authorityBoundary<T>(code: AgentSessionErrorCode, parse: () => T): T {
  try {
    return parse();
  } catch (cause: unknown) {
    throw new AgentSessionError(code, 'Session lifecycle input is invalid.', { cause });
  }
}
