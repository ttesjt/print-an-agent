import { InvalidWorkbenchValueError } from './errors.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export function parseJsonValue(input: unknown, path = 'value'): JsonValue {
  return parseJsonValueInternal(input, path, new WeakSet<object>());
}

export function canonicalJson(input: JsonValue): string {
  return JSON.stringify(input);
}

function parseJsonValueInternal(
  input: unknown,
  path: string,
  ancestors: WeakSet<object>
): JsonValue {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new InvalidWorkbenchValueError(path, 'must contain only finite JSON numbers');
    }
    return Object.is(input, -0) ? 0 : input;
  }
  if (typeof input !== 'object') {
    throw new InvalidWorkbenchValueError(path, 'must be a JSON value');
  }
  if (ancestors.has(input)) {
    throw new InvalidWorkbenchValueError(path, 'must not contain a cycle');
  }

  ancestors.add(input);
  try {
    if (Array.isArray(input)) {
      return Object.freeze(
        input.map((value, index) =>
          parseJsonValueInternal(value, `${path}[${String(index)}]`, ancestors)
        )
      );
    }

    const prototype: unknown = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidWorkbenchValueError(path, 'must contain only plain JSON objects');
    }
    const record = input as Readonly<Record<string, unknown>>;
    const parsed: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
      parsed[key] = parseJsonValueInternal(record[key], `${path}.${key}`, ancestors);
    }
    return Object.freeze(parsed);
  } finally {
    ancestors.delete(input);
  }
}
