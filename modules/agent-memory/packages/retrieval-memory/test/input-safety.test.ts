import { expect, it } from 'vitest';
import { fixture } from './support/fixture.js';
import {
  prepareCosineVector,
  assertCanonicalVector,
  createCodepointChunker,
  parseMetadataFilter,
  matchesMetadata,
  jsonSnapshot,
} from '../src/index.js';
it.each([1e20, 1e-30, Number.MAX_VALUE, Number.MIN_VALUE])(
  'normalizes extreme finite scale %s before float32 conversion',
  (scale) => {
    const raw = [scale, 0, 0, 0];
    expect(prepareCosineVector(raw, 4)).toEqual([1, 0, 0, 0]);
    expect(raw[0]).toBe(scale);
  }
);
it('handles signed high-dimensional vectors and rejects noncanonical prepared vectors', () => {
  const raw = Array.from({ length: 8192 }, (_, i) => (i % 2 ? -1 : 1) * 1e300);
  expect(() =>
    assertCanonicalVector(prepareCosineVector(raw, raw.length), raw.length)
  ).not.toThrow();
  for (const vector of [
    [0, 0],
    [Infinity, 1],
    [NaN, 1],
  ])
    expect(() => prepareCosineVector(vector, 2)).toThrow();
  expect(() => assertCanonicalVector([1e20, 0], 2)).toThrow();
});
it.each(['\ud800', '\ud801', '\udfff'])(
  'rejects malformed Unicode %j before any lookup or encoding',
  async (invalid) => {
    const f = fixture();
    for (const input of [
      { memoryId: invalid, requestId: 'r', content: 'x' },
      { memoryId: 'space', requestId: invalid, content: 'x' },
      { memoryId: 'space', requestId: 'r', content: invalid },
      { memoryId: 'space', requestId: 'r', content: 'x', metadata: { [invalid]: 'x' } },
      { memoryId: 'space', requestId: 'r', content: 'x', source: { ref: invalid } },
    ])
      await expect(f.mutations.run('ingest', input)).rejects.toMatchObject({
        code: 'INPUT_INVALID',
      });
    expect(f.calls).toEqual({ embeddings: 0, publication: 0 });
  }
);
it('preserves valid Unicode and NUL text and does not split a surrogate pair', async () => {
  const input = 'a😀b\0e\u0301\ufffd';
  const chunker = createCodepointChunker({ window: 2, overlap: 0 });
  const chunks = await chunker.chunk(input, new AbortController().signal);
  expect(chunks.map((chunk) => chunk.text).join('')).toBe(input);
  expect(chunks.every((chunk) => chunk.text.isWellFormed())).toBe(true);
  expect(jsonSnapshot({ input })).toEqual({ input });
});
it('uses strict metadata semantics, arbitrary property names and object-only traversal', () => {
  const data = { 'a.b': { '\0': null }, flag: true, array: ['value'] };
  expect(
    matchesMetadata(data, parseMetadataFilter({ op: 'eq', path: ['a.b', '\0'], value: null }))
  ).toBe(true);
  expect(matchesMetadata(data, parseMetadataFilter({ op: 'eq', path: ['flag'], value: 1 }))).toBe(
    false
  );
  expect(
    matchesMetadata(data, parseMetadataFilter({ op: 'exists', path: ['array', '0'], value: false }))
  ).toBe(true);
  expect(
    matchesMetadata(data, parseMetadataFilter({ op: 'eq', path: ['missing'], value: null }))
  ).toBe(false);
});
