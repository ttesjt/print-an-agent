import { expect, it } from 'vitest';
import {
  TOKEN_MEASUREMENT_ACCURACY,
  TOKEN_MEASUREMENT_SCOPE,
  TokenMeasurementError,
} from '@ta-agent/model-invocation-core';
import {
  createCharacterTokenEstimator,
  createTiktokenTextCounter,
  TIKTOKEN_ENCODING,
} from '../../src/index.js';

const signal = () => new AbortController().signal;
it.each(Object.values(TIKTOKEN_ENCODING))(
  'counts known ordinary text exactly with %s',
  async (encoding) => {
    const counter = createTiktokenTextCounter({ encoding });
    for (const [text, tokens] of [
      ['', 0],
      ['hello world', 2],
    ] as const) {
      expect(await counter.measure({ kind: 'text', text }, signal())).toMatchObject({
        tokens,
        accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
        scope: TOKEN_MEASUREMENT_SCOPE.TEXT,
      });
    }
    const special = await counter.measure({ kind: 'text', text: '<|endoftext|>中文😀' }, signal());
    expect(special.tokens).toBeGreaterThan(0);
    expect(Object.isFrozen(counter.descriptor)).toBe(true);
  }
);
it('marks estimates and differentiates every counting option in identity', async () => {
  const a = createCharacterTokenEstimator();
  const b = createCharacterTokenEstimator({ charactersPerToken: 2 });
  expect(a.descriptor.measurementRef).not.toBe(b.descriptor.measurementRef);
  expect(await a.measure({ kind: 'text', text: 'hello' }, signal())).toMatchObject({
    tokens: 2,
    accuracy: TOKEN_MEASUREMENT_ACCURACY.ESTIMATED,
  });
  expect((await a.measure({ kind: 'text', text: '' }, signal())).tokens).toBe(0);
});
it.each([
  (): unknown => Reflect.apply(createTiktokenTextCounter, undefined, [{ encoding: 'other' }]),
  () => createCharacterTokenEstimator({ charactersPerToken: 0 }),
  () => createCharacterTokenEstimator({ charactersPerToken: Infinity }),
  (): unknown => Reflect.apply(createCharacterTokenEstimator, undefined, [{ extra: true }]),
  (): unknown => Reflect.apply(createTiktokenTextCounter, undefined, [null]),
  (): unknown =>
    Reflect.apply(createCharacterTokenEstimator, undefined, [{ charactersPerToken: undefined }]),
])('rejects unsupported configuration', (factory) => {
  expect(factory).toThrow(TokenMeasurementError);
});
it('preserves cancellation and does not cancel other measurements sharing a vocabulary', async () => {
  const counter = createTiktokenTextCounter({ encoding: TIKTOKEN_ENCODING.CL100K_BASE });
  const cancelled = new AbortController();
  const reason = new Error('caller stopped');
  const a = counter.measure({ kind: 'text', text: 'hello' }, cancelled.signal);
  cancelled.abort(reason);
  const b = counter.measure({ kind: 'text', text: 'hello world' }, signal());
  await expect(a).rejects.toBe(reason);
  expect((await b).tokens).toBe(2);
});
