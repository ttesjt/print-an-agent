import {
  TOKEN_MEASUREMENT_ACCURACY,
  TOKEN_MEASUREMENT_SCOPE,
  type TokenMeasurementAccuracy,
  type TokenMeasurementScope,
} from './contracts.js';
import {
  hasMeasurementErrorCode,
  TokenMeasurementError,
  type TokenMeasurementErrorCode,
} from './errors.js';

const MAX_REFERENCE_LENGTH = 256;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

/** Read data descriptors, never getters, including at untyped JavaScript boundaries. */
export function readClosedRecord(
  value: unknown,
  allowedKeys: readonly string[],
  code: TokenMeasurementErrorCode
): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TokenMeasurementError(code, 'Expected a plain closed record.');
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TokenMeasurementError(code, 'Expected a plain closed record.');
    }
    const fields: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowedKeys.includes(key)) {
        throw new TokenMeasurementError(code, 'Record contains an unsupported field.');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TokenMeasurementError(code, 'Fields must be enumerable data properties.');
      }
      fields[key] = descriptor.value;
    }
    return Object.freeze(fields);
  } catch (cause: unknown) {
    if (hasMeasurementErrorCode(cause, [code])) throw cause;
    throw new TokenMeasurementError(code, 'Record could not be inspected.', { cause });
  }
}

export function parseMeasurementReference(value: unknown, code: TokenMeasurementErrorCode): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_REFERENCE_LENGTH ||
    !REFERENCE_PATTERN.test(value)
  ) {
    throw new TokenMeasurementError(code, 'Expected a bounded, nonempty measurement identifier.');
  }
  return value;
}

export function parseMeasurementScope(
  value: unknown,
  code: TokenMeasurementErrorCode
): TokenMeasurementScope {
  if (
    value !== TOKEN_MEASUREMENT_SCOPE.TEXT &&
    value !== TOKEN_MEASUREMENT_SCOPE.CONTENT &&
    value !== TOKEN_MEASUREMENT_SCOPE.REQUEST
  ) {
    throw new TokenMeasurementError(code, 'Unsupported measurement scope.');
  }
  return value;
}

export function parseMeasurementAccuracy(
  value: unknown,
  code: TokenMeasurementErrorCode
): TokenMeasurementAccuracy {
  if (
    value !== TOKEN_MEASUREMENT_ACCURACY.EXACT &&
    value !== TOKEN_MEASUREMENT_ACCURACY.ESTIMATED
  ) {
    throw new TokenMeasurementError(code, 'Unsupported measurement accuracy.');
  }
  return value;
}

export function parseInputKinds(value: unknown): readonly string[] {
  const code = 'TOKEN_MEASUREMENT_BINDING_INVALID';
  try {
    if (!Array.isArray(value))
      throw new TokenMeasurementError(code, 'Input kinds must be an array.');
    const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (typeof length !== 'number' || length < 1 || Reflect.ownKeys(value).length !== length + 1) {
      throw new TokenMeasurementError(code, 'Input kinds must be a nonempty dense data array.');
    }
    const kinds: string[] = [];
    for (let index = 0; index < length; index++) {
      const entry = Object.getOwnPropertyDescriptor(value, String(index));
      if (entry === undefined || !entry.enumerable || !('value' in entry)) {
        throw new TokenMeasurementError(code, 'Input kinds must contain only data entries.');
      }
      kinds.push(parseMeasurementReference(entry.value, code));
    }
    if (new Set(kinds).size !== kinds.length) {
      throw new TokenMeasurementError(code, 'Input kinds cannot contain duplicates.');
    }
    return Object.freeze(kinds);
  } catch (cause: unknown) {
    if (hasMeasurementErrorCode(cause, [code])) throw cause;
    throw new TokenMeasurementError(code, 'Input kinds could not be inspected.', { cause });
  }
}

/** The custom protocol owns all other fields; this checks its advertised discriminant. */
export function readTokenInputKind(value: unknown): string {
  const code = 'TOKEN_MEASUREMENT_INPUT_INVALID';
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TokenMeasurementError(code, 'Token input must be a plain structured value.');
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TokenMeasurementError(code, 'Token input must be a plain structured value.');
    }
    const kind = Object.getOwnPropertyDescriptor(value, 'kind');
    if (kind === undefined || !kind.enumerable || !('value' in kind)) {
      throw new TokenMeasurementError(code, 'Token input must have a data kind discriminant.');
    }
    return parseMeasurementReference(kind.value, code);
  } catch (cause: unknown) {
    if (hasMeasurementErrorCode(cause, [code])) throw cause;
    throw new TokenMeasurementError(code, 'Token input could not be inspected.', { cause });
  }
}
