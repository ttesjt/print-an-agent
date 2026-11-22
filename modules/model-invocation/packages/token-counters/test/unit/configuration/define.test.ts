import { expect, it, vi } from 'vitest';
import { defineTextTokenCounterConfig } from '../../../src/index.js';

it('normalizes heuristic parameters deterministically without loading a tokenizer', () => {
  const implicit = defineTextTokenCounterConfig({ kind: 'character-estimator' });
  const explicit = defineTextTokenCounterConfig({
    charactersPerToken: 4,
    kind: 'character-estimator',
  });
  expect(implicit).toEqual(explicit);
  expect(JSON.stringify(implicit)).toBe(JSON.stringify(explicit));
  expect(Object.isFrozen(implicit)).toBe(true);
});
it.each([
  null,
  {},
  { kind: 'unknown' },
  { kind: 'tiktoken' },
  { kind: 'tiktoken', encoding: 'unknown' },
  { kind: 'tiktoken', encoding: 'cl100k_base', extra: 1 },
  { kind: 'reference', measurementRef: 'not a ref' },
  { kind: 'reference', measurementRef: '' },
  { kind: 'reference', measurementRef: 'test:ref', encoding: 'cl100k_base' },
  { kind: 'character-estimator', charactersPerToken: undefined },
  { kind: 'character-estimator', charactersPerToken: 0 },
  { kind: 'character-estimator', charactersPerToken: Infinity },
])('rejects invalid declarations %j', (input) => {
  expect(() => defineTextTokenCounterConfig(input)).toThrow();
});
it('does not execute getter fields at the configuration boundary', () => {
  const get = vi.fn(() => 'tiktoken');
  expect(() =>
    defineTextTokenCounterConfig(Object.defineProperty({}, 'kind', { get, enumerable: true }))
  ).toThrow();
  expect(get).not.toHaveBeenCalled();
});
