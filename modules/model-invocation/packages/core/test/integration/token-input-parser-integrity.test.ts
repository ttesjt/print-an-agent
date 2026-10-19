import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { createTokenCounter, TEXT_TOKEN_INPUT_CONTRACT } from '../../src/index.js';
import {
  measurementSignal,
  textCounterDefinition,
  textInput,
} from '../support/token-measurement.js';

it.each([
  ['local', 'resolve'],
  ['local', 'reject'],
  ['foreign', 'resolve'],
  ['foreign', 'reject'],
] as const)(
  'rejects a %s-realm asynchronous parser after it %ss without leaking rejection',
  async (realm, outcome) => {
    const measure = vi.fn(textCounterDefinition().measure);
    const inputContract = { ...TEXT_TOKEN_INPUT_CONTRACT };
    Object.defineProperty(inputContract, 'parse', {
      value: () => {
        const parsed: unknown =
          realm === 'foreign'
            ? runInNewContext(
                outcome === 'resolve'
                  ? 'Promise.resolve({ kind: "text", text: "x" })'
                  : 'Promise.reject(new Error("invalid asynchronous parser"))'
              )
            : outcome === 'resolve'
              ? Promise.resolve(textInput('x'))
              : Promise.reject(new Error('invalid asynchronous parser'));
        if (realm === 'foreign') expect(parsed).not.toBeInstanceOf(Promise);
        return parsed;
      },
    });
    const counter = createTokenCounter({ ...textCounterDefinition(), inputContract, measure });
    await expect(counter.measure(textInput('x'), measurementSignal())).rejects.toMatchObject({
      code: 'TOKEN_MEASUREMENT_INPUT_INVALID',
    });
    // Yield past the unhandled-rejection checkpoint; Vitest fails on any leaked rejection.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(measure).not.toHaveBeenCalled();
  }
);

it('observes a native Promise rejection without reading its overridden then property', async () => {
  const measure = vi.fn(textCounterDefinition().measure);
  const thenGetter = vi.fn(() => {
    throw new Error('Promise.then must not be read');
  });
  const inputContract = { ...TEXT_TOKEN_INPUT_CONTRACT };
  Object.defineProperty(inputContract, 'parse', {
    value: () => {
      const parsed: unknown = Object.defineProperty(
        Promise.reject(new Error('invalid asynchronous parser')),
        'then',
        { get: thenGetter }
      );
      return parsed;
    },
  });
  const counter = createTokenCounter({ ...textCounterDefinition(), inputContract, measure });
  await expect(counter.measure(textInput('x'), measurementSignal())).rejects.toMatchObject({
    code: 'TOKEN_MEASUREMENT_INPUT_INVALID',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(thenGetter).not.toHaveBeenCalled();
  expect(measure).not.toHaveBeenCalled();
});

it.each(['value', 'getter'] as const)(
  'does not assimilate or inspect a synchronous payload then %s',
  async (property) => {
    const then = vi.fn(() => {
      throw new Error('Payload.then must not be called');
    });
    const thenGetter = vi.fn(() => then);
    const parsed = { ...textInput('x') };
    Object.defineProperty(
      parsed,
      'then',
      property === 'value' ? { value: then } : { get: thenGetter }
    );
    const measure = vi.fn(textCounterDefinition().measure);
    const counter = createTokenCounter({
      ...textCounterDefinition(),
      inputContract: { ...TEXT_TOKEN_INPUT_CONTRACT, parse: () => parsed },
      measure,
    });
    const signal = measurementSignal();
    await expect(counter.measure(textInput('x'), signal)).resolves.toMatchObject({ tokens: 1 });
    expect(thenGetter).not.toHaveBeenCalled();
    expect(then).not.toHaveBeenCalled();
    expect(measure).toHaveBeenCalledOnce();
    expect(measure.mock.calls[0]?.[0]).toBe(parsed);
    expect(measure.mock.calls[0]?.[1]).toBe(signal);
  }
);
