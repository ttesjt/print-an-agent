import { expect, it, vi } from 'vitest';
import {
  defineSessionCompactionTarget,
  bindSessionCompactionTokenCounter,
  measureSessionCompactionText,
  refineSessionCompactionPromptTarget,
  resolveSessionCompactionTarget,
} from '../../src/index.js';
import { testTextCounter } from '../support/text-token-counter.js';

it('resolves direct and calculated targets without relaxing the hard limit', () => {
  expect(resolveSessionCompactionTarget(4096, { ratio: 0.8 })).toBe(3276);
  expect(resolveSessionCompactionTarget(4096, {}, { maxTokens: 3000 })).toBe(3000);
  expect(
    resolveSessionCompactionTarget(4096, {}, { limitTokens: 4096, ratio: 0.8, reserveTokens: 128 })
  ).toBe(3148);
  expect(resolveSessionCompactionTarget(4096, { ratio: 0.5 }, { reserveTokens: 48 })).toBe(2000);
  expect(() => resolveSessionCompactionTarget(4096, {}, { maxTokens: 4097 })).toThrow();
  expect(() => resolveSessionCompactionTarget(4096, {}, { reserveTokens: 4096 })).toThrow();
  const target = defineSessionCompactionTarget({ maxTokens: 100 });
  expect(Object.isFrozen(target)).toBe(true);
});

it.each([
  null,
  [],
  { maxTokens: 1, ratio: 0.8 },
  { maxTokens: undefined },
  { maxTokens: 0 },
  { limitTokens: Infinity },
  { ratio: 0 },
  { ratio: 1.1 },
  { reserveTokens: -1 },
  { reserveTokens: 0.5 },
  { unknown: 1 },
])('rejects invalid or ambiguous targets: %j', (target) => {
  expect(() => defineSessionCompactionTarget(target)).toThrow();
});

it('rejects getters without evaluating them', () => {
  const getter = vi.fn(() => 10);
  const target = Object.defineProperty({}, 'maxTokens', { enumerable: true, get: getter });
  expect(() => defineSessionCompactionTarget(target)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it('tightens the soft target from measured overshoot while respecting the minimum', () => {
  const feedback = {
    currentTargetTokens: 3000,
    actualTokens: 4500,
    targetTokens: 3000,
    retrySafetyFactor: 0.9,
    minimumTargetTokens: 1,
  };
  expect(refineSessionCompactionPromptTarget(feedback)).toBe(1800);
  expect(refineSessionCompactionPromptTarget({ ...feedback, retrySafetyFactor: 0.5 })).toBe(1000);
  expect(refineSessionCompactionPromptTarget({ ...feedback, minimumTargetTokens: 2000 })).toBe(
    2000
  );
  expect(() =>
    refineSessionCompactionPromptTarget({ ...feedback, minimumTargetTokens: 3001 })
  ).toThrow();
  expect(() =>
    refineSessionCompactionPromptTarget({ ...feedback, retrySafetyFactor: 0 })
  ).toThrow();
});

it('uses the exact text and explicit tokenizer identity without estimating or mutating bindings', async () => {
  const count = vi.fn(() => Promise.resolve(7));
  const counter = testTextCounter(count, 'consumer-vocabulary:revision');
  const input = { ...counter, descriptor: { ...counter.descriptor } };
  const tokenization = bindSessionCompactionTokenCounter(input);
  input.descriptor.measurementRef = 'different';
  const signal = new AbortController().signal;
  await expect(
    measureSessionCompactionText('多语言 exact text', tokenization, signal)
  ).resolves.toBe(7);
  expect(count).toHaveBeenCalledWith('多语言 exact text');
  expect(tokenization.descriptor.measurementRef).toBe('consumer-vocabulary:revision');
});

it.each([-1, 0.5, NaN, Infinity])('rejects invalid tokenizer measurements: %s', async (tokens) => {
  await expect(
    measureSessionCompactionText(
      'text',
      testTextCounter(() => Promise.resolve(tokens)),
      new AbortController().signal
    )
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_TOKENIZER_FAILED' });
});

it('preserves counting failures as causes and never relabels cancellation', async () => {
  const failure = new Error('counter unavailable');
  const controller = new AbortController();
  const tokenization = testTextCounter(() => Promise.reject(failure));
  await expect(
    measureSessionCompactionText('text', tokenization, controller.signal)
  ).rejects.toMatchObject({
    code: 'SESSION_COMPACTION_TOKENIZER_FAILED',
    cause: { cause: failure },
  });
  controller.abort(failure);
  await expect(measureSessionCompactionText('text', tokenization, controller.signal)).rejects.toBe(
    failure
  );
});
