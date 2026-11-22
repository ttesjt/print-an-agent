import { expect, it } from 'vitest';
import { decodeVector, encodeVector } from '../../../src/database/vector-codec.js';

it('decodes only the supplied bytes even for unaligned views and owns its result', () => {
  const vector = new Float32Array([0.8, 0.6, 0, 0]);
  const bytes = new Uint8Array(vector.byteLength + 3);
  bytes.fill(255);
  bytes.set(new Uint8Array(vector.buffer), 1);
  const decoded = decodeVector(bytes.subarray(1, 1 + vector.byteLength), 4);
  bytes.fill(0);
  expect(decoded).toEqual(Array.from(vector));
});

it.each([null, [1, 0, 0, 0], new Uint8Array(15), new Uint8Array(17)])(
  'rejects an invalid persisted vector %s',
  (value) => {
    expect(() => decodeVector(value, 4)).toThrow('Invalid stored vector bytes.');
  }
);

it('encodes an owned float32 copy without renormalizing the vector', () => {
  const vector = [0.8, 0.6, 0, 0];
  const binary = encodeVector(vector);
  vector.fill(0);
  expect(Array.from(binary)).toEqual([Math.fround(0.8), Math.fround(0.6), 0, 0]);
});
