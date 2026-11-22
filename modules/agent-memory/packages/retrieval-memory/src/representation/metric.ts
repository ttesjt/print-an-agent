import { fail } from '../errors.js';

export const COSINE_METRIC_REF = 'cosine-unit-f32-v1';

export const FLOAT32_EPSILON = 2 ** -23;

export const UNIT_NORM_TOLERANCE = 8 * FLOAT32_EPSILON;

/** Stable in binary64 before quantization: neither raw squares nor raw float32 casts are safe. */
export function prepareCosineVector(raw: readonly number[], dimensions: number): readonly number[] {
  if (raw.length !== dimensions || dimensions < 1 || raw.some((value) => !Number.isFinite(value)))
    fail('EMBEDDING_INVALID', 'Embedding dimensions or numbers are invalid.');
  let maximum = 0;
  for (const value of raw) maximum = Math.max(maximum, Math.abs(value));
  if (maximum === 0) fail('EMBEDDING_INVALID', 'Cosine embedding must be nonzero.');
  const scaled = raw.map((value) => value / maximum);
  const norm = Math.sqrt(scaled.reduce((sum, value) => sum + value * value, 0));
  const vector = Array.from(new Float32Array(scaled.map((value) => value / norm)));
  assertCanonicalVector(vector, dimensions);
  return Object.freeze(vector);
}

export function assertCanonicalVector(vector: readonly number[], dimensions: number): void {
  const untrusted: unknown = vector;
  if (
    !Array.isArray(untrusted) ||
    vector.length !== dimensions ||
    vector.some((value) => !Number.isFinite(value) || Math.fround(value) !== value)
  )
    fail('REPRESENTATION_INVALID', 'Vector is not a canonical float32 representation.');
  const norm = vector.reduce((sum, value) => sum + value * value, 0);
  if (Math.abs(norm - 1) > UNIT_NORM_TOLERANCE)
    fail('REPRESENTATION_INVALID', 'Cosine vector is not unit length.');
}
