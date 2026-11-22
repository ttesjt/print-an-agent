import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  createCharacterTokenEstimator,
  resolveTextTokenCounterConfig,
} from '../../../src/index.js';

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
