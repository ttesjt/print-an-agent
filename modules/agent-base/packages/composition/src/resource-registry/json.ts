import { ResourceError } from './errors.js';

export type ResourceJson =
  | null
  | boolean
  | number
  | string
  | readonly ResourceJson[]
  | {
      readonly [key: string]: ResourceJson;
    };

function invalid(): never {
  throw new ResourceError('RESOURCE_BINDING_CONFLICT', 'Resource identity must be JSON-safe.');
}

function check(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (!value.isWellFormed()) invalid();
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) invalid();
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    invalid();
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (Array.isArray(value) && keys.length !== value.length + 1) invalid();
  for (const key of keys) {
    if (typeof key !== 'string' || !key.isWellFormed()) invalid();
    if (Array.isArray(value) && key === 'length') continue;
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
      invalid();
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) invalid();
    check(descriptor.value, seen);
  }
  seen.delete(value);
}

function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

/** Validates before cloning: accessors/toJSON/live handles are never executed by the framework. */
export function snapshotJson<T>(value: T): T {
  check(value, new Set());
  const snapshot = structuredClone(value);
  freeze(snapshot);
  return snapshot;
}

export function canonicalJson(value: ResourceJson): string {
  if (Object.is(value, -0)) return '-0';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (isJsonArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(',')}}`;
}

function isJsonArray(value: ResourceJson): value is readonly ResourceJson[] {
  return Array.isArray(value);
}

/** Checks wiring records without invoking getters or freezing caller-owned objects. */
export function assertWiringRecord(input: unknown, fields?: readonly string[]): void {
  if (
    input === null ||
    typeof input !== 'object' ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  ) {
    throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'A wiring record is invalid.');
  }
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      typeof key !== 'string' ||
      descriptor === undefined ||
      !('value' in descriptor) ||
      !descriptor.enumerable ||
      (fields !== undefined && !fields.includes(key))
    ) {
      throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'A wiring field is invalid.');
    }
  }
}

export function assertName(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    !value.isWellFormed() ||
    value.includes('\0')
  ) {
    throw new ResourceError('RESOURCE_BLUEPRINT_INVALID', 'A resource name or key is invalid.');
  }
}
