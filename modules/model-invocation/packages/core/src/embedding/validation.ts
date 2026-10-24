import { EmbeddingError, type EmbeddingErrorCode } from './errors.js';

const MAX_EMBEDDING_REFERENCE_LENGTH = 256;
const EMBEDDING_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

/** Data-only boundaries must not execute getters or accept hidden/symbol fields. */
export function readEmbeddingRecord(
  value: unknown,
  keys: readonly string[],
  code: EmbeddingErrorCode
): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new EmbeddingError(code, 'Expected an embedding record.');
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new EmbeddingError(code, 'Expected a plain embedding record.');
    }
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !keys.includes(key)) {
        throw new EmbeddingError(code, 'Embedding record contains an unsupported field.');
      }
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (field === undefined || !field.enumerable || !('value' in field)) {
        throw new EmbeddingError(code, 'Embedding fields must be enumerable data properties.');
      }
      result[key] = field.value;
    }
    return result;
  } catch (cause: unknown) {
    if (cause instanceof EmbeddingError) throw cause;
    throw new EmbeddingError(code, 'Embedding record could not be inspected.', { cause });
  }
}

/** Read only the array header so size policy can reject before key enumeration or copying. */
export function readEmbeddingArrayLength(value: unknown, code: EmbeddingErrorCode): number {
  try {
    if (!Array.isArray(value)) throw new EmbeddingError(code, 'Expected an embedding array.');
    const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
      throw new EmbeddingError(code, 'Embedding array has an invalid length.');
    }
    return length;
  } catch (cause: unknown) {
    if (cause instanceof EmbeddingError) throw cause;
    throw new EmbeddingError(code, 'Embedding array length could not be inspected.', { cause });
  }
}

export function readEmbeddingArray(
  value: unknown,
  code: EmbeddingErrorCode,
  expectedLength?: number
): readonly unknown[] {
  try {
    if (!Array.isArray(value)) throw new EmbeddingError(code, 'Expected an embedding array.');
    const length = readEmbeddingArrayLength(value, code);
    if (
      (expectedLength !== undefined && length !== expectedLength) ||
      Reflect.ownKeys(value).length !== length + 1
    ) {
      throw new EmbeddingError(code, 'Embedding array has invalid size or fields.');
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const entry = Object.getOwnPropertyDescriptor(value, String(index));
      if (entry === undefined || !entry.enumerable || !('value' in entry)) {
        throw new EmbeddingError(code, 'Embedding arrays must contain dense data entries.');
      }
      result.push(entry.value);
    }
    return result;
  } catch (cause: unknown) {
    if (cause instanceof EmbeddingError) throw cause;
    throw new EmbeddingError(code, 'Embedding array could not be inspected.', { cause });
  }
}

export function readEmbeddingReference(value: unknown, code: EmbeddingErrorCode): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_EMBEDDING_REFERENCE_LENGTH ||
    !EMBEDDING_REFERENCE_PATTERN.test(value)
  ) {
    throw new EmbeddingError(code, 'Embedding references must be bounded ASCII identifiers.');
  }
  return value;
}

export function readPositiveInteger(value: unknown, code: EmbeddingErrorCode): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new EmbeddingError(code, 'Expected a positive safe integer.');
  }
  return value;
}
