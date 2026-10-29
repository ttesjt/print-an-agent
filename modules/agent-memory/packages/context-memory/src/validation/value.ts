import type { JsonObject, JsonValue } from '../contracts/document.js';
import { ContextMemoryError, type ContextMemoryErrorCode } from '../errors.js';

export function record(
  value: unknown,
  label: string,
  code: ContextMemoryErrorCode = 'INPUT_INVALID'
): Record<string, unknown> {
  const prototype: unknown =
    typeof value === 'object' && value !== null ? Object.getPrototypeOf(value) : undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw new ContextMemoryError(code, `${label} must be a plain object.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new ContextMemoryError(code, `${label} must contain only enumerable data properties.`);
    }
  }
  return value as Record<string, unknown>;
}
export function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: ContextMemoryErrorCode = 'INPUT_INVALID'
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new ContextMemoryError(code, 'Unexpected input field.');
}
export function identity(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.isWellFormed() ||
    value.trim().length === 0 ||
    value.includes('\0')
  ) {
    throw new ContextMemoryError('INPUT_INVALID', `${label} must be a nonempty identity.`);
  }
  return value;
}
export function integer(
  value: unknown,
  label: string,
  minimum = 0,
  code: ContextMemoryErrorCode = 'INPUT_INVALID'
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new ContextMemoryError(code, `${label} must be a safe integer >= ${minimum}.`);
  }
  return value;
}

export function jsonValue(value: unknown, seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null || seen.has(value))
    throw new ContextMemoryError('INPUT_INVALID', 'Value must be finite, acyclic JSON data.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.keys(value).length !== value.length ||
        Reflect.ownKeys(value).length !== value.length + 1
      )
        throw new ContextMemoryError(
          'INPUT_INVALID',
          'JSON arrays cannot be sparse or have extra properties.'
        );
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor))
          throw new ContextMemoryError('INPUT_INVALID', 'JSON arrays cannot have accessors.');
      }
      return value.map((entry: unknown) => jsonValue(entry, seen));
    }
    return Object.fromEntries(
      Object.entries(record(value, 'JSON object')).map(([key, entry]) => [
        key,
        jsonValue(entry, seen),
      ])
    );
  } finally {
    seen.delete(value);
  }
}
export function jsonObject(value: unknown): JsonObject {
  record(value, 'metadata');
  return jsonValue(value) as JsonObject;
}
export function canonicalJson(value: JsonValue): string {
  return serializeCanonical(jsonValue(value));
}
function serializeCanonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serializeCanonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${serializeCanonical(entry)}`)
    .join(',')}}`;
}
