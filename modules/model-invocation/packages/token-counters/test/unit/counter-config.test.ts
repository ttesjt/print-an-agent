import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  createCharacterTokenEstimator,
  defineTextTokenCounterConfig,
  resolveTextTokenCounterConfig,
} from '../../src/index.js';

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
it('requires explicit references and validates the resolved measurement identity', async () => {
  const counter = createCharacterTokenEstimator();
  const declaration = {
    kind: 'reference',
    measurementRef: counter.descriptor.measurementRef,
  } as const;
  expect(() => resolveTextTokenCounterConfig(declaration)).toThrow();
  expect(() =>
    resolveTextTokenCounterConfig(
      { kind: 'reference', measurementRef: 'test:missing' },
      () => counter
    )
  ).toThrow();
  const bound = resolveTextTokenCounterConfig(declaration, (ref) => {
    expect(ref).toBe(counter.descriptor.measurementRef);
    return counter;
  });
  await expect(
    bound.measure({ kind: 'text', text: 'hello' }, new AbortController().signal)
  ).resolves.toMatchObject({ tokens: 2, accuracy: 'estimated' });
});

it('rejects an untyped cross-realm async reference resolver without leaking its rejection', async () => {
  const invoke = (): unknown =>
    Reflect.apply(resolveTextTokenCounterConfig, undefined, [
      { kind: 'reference', measurementRef: 'test:async' },
      () => {
        const value: unknown = runInNewContext('Promise.reject(new Error("invalid async lookup"))');
        return value;
      },
    ]);
  expect(invoke).toThrow();
  await new Promise<void>((resolve) => setImmediate(resolve));
});
