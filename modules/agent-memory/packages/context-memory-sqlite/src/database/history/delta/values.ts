import type { JsonValue } from '@print-an-agent/context-memory';

export const array = (value: JsonValue): value is JsonValue[] => Array.isArray(value);

export const object = (value: JsonValue): value is { readonly [key: string]: JsonValue } =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
