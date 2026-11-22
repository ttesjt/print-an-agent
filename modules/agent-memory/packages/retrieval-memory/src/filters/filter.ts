import type { JsonObject } from '../types/json.js';
import type { MetadataFilter, Primitive } from './types.js';
import { DEFAULT_RETRIEVAL_POLICY } from '../policy/index.js';
import type { RetrievalPolicy } from '../policy/index.js';
import { exact, record, text } from '../values/index.js';
import { fail } from '../errors.js';

function primitive(value: unknown): Primitive {
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  return text(value);
}

export function parseMetadataFilter(
  value: unknown,
  policy: RetrievalPolicy = DEFAULT_RETRIEVAL_POLICY
): MetadataFilter {
  let leaves = 0;
  const visit = (value: unknown, depth: number): MetadataFilter => {
    const data = record(value);
    if (policy.maxFilterDepth !== null && depth > policy.maxFilterDepth)
      fail('INPUT_INVALID', 'Filter nesting exceeds policy.');
    if (data.op === 'and') {
      exact(data, ['op', 'filters']);
      if (!Array.isArray(data.filters) || data.filters.length === 0)
        fail('INPUT_INVALID', 'Expected nonempty filter list.');
      return { op: 'and', filters: data.filters.map((item) => visit(item, depth + 1)) };
    }
    if (policy.maxFilterLeaves !== null && ++leaves > policy.maxFilterLeaves)
      fail('INPUT_INVALID', 'Too many filter leaves.');
    if (!Array.isArray(data.path) || data.path.length === 0)
      fail('INPUT_INVALID', 'Expected an object property path.');
    const path = data.path.map((key) => text(key));
    if (data.op === 'eq') {
      exact(data, ['op', 'path', 'value']);
      return { op: 'eq', path, value: primitive(data.value) };
    }
    if (data.op === 'in') {
      exact(data, ['op', 'path', 'values']);
      if (!Array.isArray(data.values) || data.values.length === 0)
        fail('INPUT_INVALID', 'Expected nonempty primitive values.');
      return { op: 'in', path, values: data.values.map(primitive) };
    }
    if (data.op === 'exists' && typeof data.value === 'boolean') {
      exact(data, ['op', 'path', 'value']);
      return { op: 'exists', path, value: data.value };
    }
    return fail('INPUT_INVALID', 'Unsupported metadata filter.');
  };
  return visit(value, 1);
}

export function matchesMetadata(metadata: JsonObject, filter: MetadataFilter): boolean {
  if (filter.op === 'and') return filter.filters.every((item) => matchesMetadata(metadata, item));
  let current: unknown = metadata;
  let exists = true;
  for (const key of filter.path) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current) ||
      !Object.hasOwn(current, key)
    ) {
      exists = false;
      break;
    }
    current = Reflect.get(current, key);
  }
  if (filter.op === 'exists') return exists === filter.value;
  if (!exists) return false;
  return filter.op === 'eq'
    ? current === filter.value
    : filter.values.some((value) => current === value);
}
