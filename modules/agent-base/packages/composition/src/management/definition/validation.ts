import { ManagedAgentCompositionError } from './errors.js';

export type UnknownRecord = Readonly<Record<PropertyKey, unknown>>;

function invalid(fieldPath: string, expectation: string): never {
  throw new ManagedAgentCompositionError(
    fieldPath,
    `Managed Agent composition ${fieldPath} ${expectation}.`
  );
}

export function requireClosedRecord(
  value: unknown,
  fieldPath: string,
  allowedKeys: readonly string[]
): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(fieldPath, 'must be a record');
  }
  const record = value as UnknownRecord;
  const keys = Reflect.ownKeys(record);
  for (const key of keys) {
    if (typeof key !== 'string') {
      return invalid(fieldPath, 'contains an unsupported symbol field');
    }
    if (!allowedKeys.includes(key)) {
      return invalid(`${fieldPath}.${key}`, 'is not supported');
    }
  }
  for (const key of allowedKeys) {
    if (!Object.hasOwn(record, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      return invalid(`${fieldPath}.${key}`, 'must be a data property');
    }
  }
  return record;
}

export function requireDataProperty(
  record: UnknownRecord,
  key: string,
  fieldPath: string
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
    return invalid(fieldPath, 'is required and must be a data property');
  }
  return descriptor.value;
}

function findDataProperty(value: object, key: string): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      if (!Object.hasOwn(descriptor, 'value')) return undefined;
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function requireObject(value: unknown, fieldPath: string): object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return invalid(fieldPath, 'must be an object');
  }
  return value;
}

function requireFunctionMember(value: object, memberName: string, fieldPath: string): void {
  if (typeof findDataProperty(value, memberName) !== 'function') {
    invalid(`${fieldPath}.${memberName}`, 'must be a function');
  }
}

export function requireFunction(
  value: unknown,
  fieldPath: string
): asserts value is (...args: never[]) => unknown {
  if (typeof value !== 'function') invalid(fieldPath, 'must be a function');
}

export function validateConfigCodec(value: unknown): void {
  const codec = requireObject(value, 'config.codec');
  const schemaVersion = findDataProperty(codec, 'schemaVersion');
  if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) <= 0) {
    invalid('config.codec.schemaVersion', 'must be a positive safe integer');
  }
  requireFunctionMember(codec, 'decode', 'config.codec');
  requireFunctionMember(codec, 'encode', 'config.codec');
}

export function validateNamespacePort(value: unknown): void {
  const port = requireObject(value, 'namespace.port');
  for (const method of ['stage', 'publish', 'abort', 'resolve', 'list']) {
    requireFunctionMember(port, method, 'namespace.port');
  }
}

export function validateProjectionPort(value: unknown): void {
  const port = requireObject(value, 'projection.port');
  requireFunctionMember(port, 'publish', 'projection.port');
  requireFunctionMember(port, 'reconcile', 'projection.port');
}
