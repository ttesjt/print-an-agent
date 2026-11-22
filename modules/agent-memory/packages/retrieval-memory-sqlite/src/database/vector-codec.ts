import { RetrievalMemoryError } from '@print-an-agent/retrieval-memory';

/** Callers validate canonical vectors; encoding must not normalize or change their meaning. */
export function encodeVector(vector: readonly number[]): Float32Array {
  return new Float32Array(vector);
}

export function decodeVector(value: unknown, dimensions: number): number[] {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT
  )
    throw new RetrievalMemoryError('STORAGE_FAILED', 'Invalid stored vector bytes.');
  // SQLite may return a view with an unaligned byteOffset. Own an aligned copy before reading floats.
  const bytes = Uint8Array.from(value);
  return Array.from(new Float32Array(bytes.buffer));
}
