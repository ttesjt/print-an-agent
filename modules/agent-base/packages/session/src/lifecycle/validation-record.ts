import { AgentSessionError, type AgentSessionErrorCode } from '../errors.js';

export function invalidLifecycle(code: AgentSessionErrorCode = 'SESSION_LIFECYCLE_INVALID'): never {
  throw new AgentSessionError(code, 'Session lifecycle value is invalid.');
}

/** Read descriptors, not properties: untrusted getters must never supply authority. */
export function lifecycleRecord(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): object {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return invalidLifecycle();
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) return invalidLifecycle();
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== 'string' || (!required.includes(key) && !optional.includes(key))
    )
  )
    return invalidLifecycle();
  for (const key of required) lifecycleField(input, key);
  for (const key of optional) {
    if (Object.hasOwn(input, key)) lifecycleField(input, key);
  }
  return input;
}

export function lifecycleField(input: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
    return invalidLifecycle();
  }
  return descriptor.value as unknown;
}

export function optionalLifecycleField(input: object, key: string): unknown {
  return Object.hasOwn(input, key) ? lifecycleField(input, key) : undefined;
}

export function lifecycleInteger(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    return invalidLifecycle();
  }
  return input;
}

/** Normalize structural/proxy/parser failures without leaking native errors at public boundaries. */
export function lifecycleBoundary<T>(code: AgentSessionErrorCode, parse: () => T): T {
  try {
    return parse();
  } catch (cause: unknown) {
    throw new AgentSessionError(code, 'Session lifecycle input is invalid.', { cause });
  }
}
