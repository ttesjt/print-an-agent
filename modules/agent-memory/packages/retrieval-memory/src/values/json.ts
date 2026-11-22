import type { JsonObject, JsonValue } from '../types/json.js';
import { fail } from '../errors.js';

/** Validate before fingerprint, UTF-8 encoding or any adapter call. No lossy repair. */
export function jsonSnapshot(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (typeof value === 'string') {
    if (!value.isWellFormed()) fail('INPUT_INVALID', 'String is not well-formed Unicode.');
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value))
    fail('INPUT_INVALID', 'Expected acyclic JSON data.');
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    fail('INPUT_INVALID', 'Expected plain JSON data.');
  ancestors.add(value);
  try {
    const entries: [string, JsonValue][] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== 'string' ||
        !key.isWellFormed() ||
        !descriptor?.enumerable ||
        !('value' in descriptor)
      )
        fail('INPUT_INVALID', 'Expected enumerable JSON data properties.');
      entries.push([key, jsonSnapshot(descriptor.value, ancestors)]);
    }
    if (Array.isArray(value)) {
      if (entries.length !== value.length || entries.some(([key], i) => key !== String(i)))
        fail('INPUT_INVALID', 'Expected a dense JSON array.');
      return entries.map(([, item]) => item);
    }
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}

export function record(value: unknown): JsonObject {
  const data = jsonSnapshot(value);
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    fail('INPUT_INVALID', 'Expected a JSON object.');
  return data;
}

export function exact(value: JsonObject, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail('INPUT_INVALID', 'Unsupported input field.');
}

export function text(value: unknown, nonblank = false): string {
  if (typeof value !== 'string' || !value.isWellFormed() || (nonblank && value.trim() === ''))
    fail('INPUT_INVALID', 'Expected valid Unicode text.');
  return value;
}

export function identifier(value: unknown, maxBytes: number | null = null): string {
  const result = text(value, true);
  if (result.includes('\0') || (maxBytes !== null && Buffer.byteLength(result) > maxBytes))
    fail('INPUT_INVALID', 'Invalid identifier.');
  return result;
}

export function integer(value: unknown, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    fail('INPUT_INVALID', 'Expected a safe integer.');
  return value;
}

export function canonical(value: unknown): string {
  const data = jsonSnapshot(value);
  if (Array.isArray(data)) return `[${data.map(canonical).join(',')}]`;
  if (data !== null && typeof data === 'object')
    return `{${Object.keys(data)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(data[key])}`)
      .join(',')}}`;
  return JSON.stringify(data);
}

export function equal(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}
