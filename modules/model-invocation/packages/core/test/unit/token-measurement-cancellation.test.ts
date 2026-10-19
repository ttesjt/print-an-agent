import { expect, it, vi } from 'vitest';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  TOKEN_MEASUREMENT_ACCURACY,
  TokenMeasurementError,
  type TokenCountResult,
} from '../../src/index.js';
import {
  measurementSignal,
  textCounterDefinition,
  textInput,
} from '../support/token-measurement.js';

const completed: TokenCountResult = { tokens: 1, accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT };

it('rejects a missing signal through the stable input boundary', async () => {
  const counter = createTokenCounter(textCounterDefinition());
  const result: unknown = Reflect.apply(counter.measure, undefined, [textInput('x')]);
  await expect(result).rejects.toMatchObject({ code: 'TOKEN_MEASUREMENT_INPUT_INVALID' });
});

it('preserves a pre-aborted parent reason without calling parser or implementation', async () => {
  const controller = new AbortController();
  const reason = new Error('parent deadline');
  controller.abort(reason);
  const parse = vi.fn(TEXT_TOKEN_INPUT_CONTRACT.parse);
  const measure = vi.fn(textCounterDefinition().measure);
  const counter = createTokenCounter({
    ...textCounterDefinition(),
    inputContract: { ...TEXT_TOKEN_INPUT_CONTRACT, parse },
    measure,
  });
  await expect(counter.measure(textInput('x'), controller.signal)).rejects.toBe(reason);
  expect(parse).not.toHaveBeenCalled();
  expect(measure).not.toHaveBeenCalled();
});

it('checks cancellation after parsing and preserves a primitive reason', async () => {
  const controller = new AbortController();
  const measure = vi.fn(textCounterDefinition().measure);
  const counter = createTokenCounter({
    ...textCounterDefinition(),
    measure,
    inputContract: {
      ...TEXT_TOKEN_INPUT_CONTRACT,
      parse(input) {
        controller.abort('caller-cancelled');
        return TEXT_TOKEN_INPUT_CONTRACT.parse(input);
      },
    },
  });
  await expect(counter.measure(textInput('x'), controller.signal)).rejects.toBe('caller-cancelled');
  expect(measure).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)(
  'joins in-flight work and preserves cancellation when it later %ss',
  async (outcome) => {
    const started = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<TokenCountResult>();
    const controller = new AbortController();
    const reason = new Error('request timeout');
    const counter = createTokenCounter({
      ...textCounterDefinition(),
      measure(_input, signal) {
        expect(signal).toBe(controller.signal);
        started.resolve();
        return pending.promise;
      },
    });
    const settled = vi.fn();
    const run = counter.measure(textInput('x'), controller.signal);
    const rejection = expect(run).rejects.toBe(reason);
    void run.then(settled, settled);
    await started.promise;
    controller.abort(reason);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    if (outcome === 'resolve') pending.resolve(completed);
    else pending.reject(new Error('backend cleanup failure'));
    await rejection;
  }
);

it('keeps concurrent input and cancellation independent', async () => {
  const firstStarted = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const firstGate = Promise.withResolvers<TokenCountResult>();
  const secondGate = Promise.withResolvers<TokenCountResult>();
  const firstController = new AbortController();
  const secondController = new AbortController();
  const firstReason = new Error('only the first caller cancelled');
  const counter = createTokenCounter({
    ...textCounterDefinition(),
    measure(input, signal) {
      if (input.text === 'first') {
        expect(signal).toBe(firstController.signal);
        firstStarted.resolve();
        return firstGate.promise;
      }
      expect(input.text).toBe('second');
      expect(signal).toBe(secondController.signal);
      secondStarted.resolve();
      return secondGate.promise;
    },
  });
  const first = counter.measure(textInput('first'), firstController.signal);
  const firstRejection = expect(first).rejects.toBe(firstReason);
  const second = counter.measure(textInput('second'), secondController.signal);
  await Promise.all([firstStarted.promise, secondStarted.promise]);
  firstController.abort(firstReason);
  secondGate.resolve({ ...completed, tokens: 6 });
  await expect(second).resolves.toMatchObject({ tokens: 6 });
  expect(secondController.signal.aborted).toBe(false);
  firstGate.resolve(completed);
  await firstRejection;
});

it('does not retry failures or rewrite an implementation-owned structured error', async () => {
  const failure = new TokenMeasurementError(
    'TOKEN_MEASUREMENT_INPUT_UNSUPPORTED',
    'Unavailable content.'
  );
  const measure = vi.fn(() => Promise.reject(failure));
  const counter = createTokenCounter({ ...textCounterDefinition(), measure });
  await expect(counter.measure(textInput('x'), measurementSignal())).rejects.toBe(failure);
  expect(measure).toHaveBeenCalledTimes(1);
});

it('preserves cancellation triggered during result inspection', async () => {
  const controller = new AbortController();
  const reason = new Error('parent cancelled while inspecting result');
  const result = new Proxy(completed, {
    ownKeys(target) {
      controller.abort(reason);
      return Reflect.ownKeys(target);
    },
  });
  const definition = textCounterDefinition();
  Object.defineProperty(definition, 'measure', { value: () => Promise.resolve(result) });
  await expect(
    createTokenCounter(definition).measure(textInput('x'), controller.signal)
  ).rejects.toBe(reason);
});
