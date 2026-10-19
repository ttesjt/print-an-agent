import { describe, expect, it, vi } from 'vitest';
import {
  createTokenCounter,
  parseTextTokenInput,
  parseTokenMeasurement,
  requireTokenMeasurement,
  TEXT_TOKEN_INPUT_CONTRACT,
  TOKEN_INPUT_KIND,
  TOKEN_MEASUREMENT_ACCURACY,
  TOKEN_MEASUREMENT_SCOPE,
  TokenMeasurementError,
} from '../../src/index.js';
import {
  counterReturning,
  measurementSignal,
  textCounterDefinition,
  textInput,
} from '../support/token-measurement.js';

function expectCode(action: () => unknown, code: string): void {
  let failure: unknown;
  try {
    action();
  } catch (cause: unknown) {
    failure = cause;
  }
  expect(failure).toBeInstanceOf(TokenMeasurementError);
  expect(failure).toMatchObject({ name: 'TokenMeasurementError', code });
}

describe('token measurement binding', () => {
  it('exports immutable protocol constants and detached binding metadata', async () => {
    const definition = {
      ...textCounterDefinition(),
      inputContract: {
        ...TEXT_TOKEN_INPUT_CONTRACT,
        inputKinds: [TOKEN_INPUT_KIND.TEXT],
      },
    };
    const counter = createTokenCounter(definition);
    definition.measurementRef = 'changed';
    definition.inputContract.ref = 'changed';
    definition.inputContract.inputKinds.pop();
    const result = await counter.measure(textInput('hello'), measurementSignal());
    expect(result).toEqual({
      tokens: 5,
      accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
      measurementRef: 'test:utf16-code-units',
      inputProtocolRef: TEXT_TOKEN_INPUT_CONTRACT.ref,
      scope: TOKEN_MEASUREMENT_SCOPE.TEXT,
    });
    for (const value of [
      counter,
      counter.descriptor,
      counter.descriptor.inputKinds,
      result,
      TOKEN_MEASUREMENT_ACCURACY,
      TOKEN_MEASUREMENT_SCOPE,
      TOKEN_INPUT_KIND,
      TEXT_TOKEN_INPUT_CONTRACT,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it.each([null, [], {}, { unexpected: true }, 'counter'])(
    'rejects malformed definitions: %j',
    (input) => {
      expectCode(() => {
        Reflect.apply(createTokenCounter, undefined, [input]);
      }, 'TOKEN_MEASUREMENT_BINDING_INVALID');
    }
  );

  it.each(['', ' space', 'space here', 'x'.repeat(257)])(
    'rejects invalid references: %j',
    (ref) => {
      expectCode(
        () => createTokenCounter({ ...textCounterDefinition(), measurementRef: ref }),
        'TOKEN_MEASUREMENT_BINDING_INVALID'
      );
    }
  );

  it.each([
    { scope: 'unknown' },
    { ref: '' },
    { inputKinds: [] },
    { inputKinds: ['text', 'text'] },
    { inputKinds: [''] },
    { inputKinds: 'text' },
    { inputKinds: new Array(2) },
    { parse: null },
    { extra: true },
  ])('rejects malformed input contracts: %j', (change) => {
    const definition = textCounterDefinition();
    Object.defineProperty(definition, 'inputContract', {
      value: { ...TEXT_TOKEN_INPUT_CONTRACT, ...change },
    });
    expectCode(() => createTokenCounter(definition), 'TOKEN_MEASUREMENT_BINDING_INVALID');
  });

  it('rejects getters, non-enumerable/symbol fields and hostile reflection without invoking getters', () => {
    const getter = vi.fn();
    const definition = textCounterDefinition();
    Object.defineProperty(definition, 'measure', { get: getter });
    expectCode(() => createTokenCounter(definition), 'TOKEN_MEASUREMENT_BINDING_INVALID');
    expect(getter).not.toHaveBeenCalled();
    for (const property of ['hidden', Symbol('hidden')]) {
      const extra = textCounterDefinition();
      Object.defineProperty(extra, property, { value: true });
      expectCode(() => createTokenCounter(extra), 'TOKEN_MEASUREMENT_BINDING_INVALID');
    }
    const revoked = Proxy.revocable(textCounterDefinition(), {});
    revoked.revoke();
    expectCode(() => createTokenCounter(revoked.proxy), 'TOKEN_MEASUREMENT_BINDING_INVALID');
    const kinds = [TOKEN_INPUT_KIND.TEXT];
    Object.defineProperty(kinds, '0', { get: getter });
    expectCode(
      () =>
        createTokenCounter({
          ...textCounterDefinition(),
          inputContract: {
            ...TEXT_TOKEN_INPUT_CONTRACT,
            inputKinds: kinds,
          },
        }),
      'TOKEN_MEASUREMENT_BINDING_INVALID'
    );
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('text input protocol', () => {
  it.each(['', '  hi\n', '中文😀e\u0301\u0000'])(
    'preserves exact text without normalization: %j',
    (text) => {
      const parsed = parseTextTokenInput(textInput(text));
      expect(parsed).toEqual(textInput(text));
      expect(Object.isFrozen(parsed)).toBe(true);
    }
  );

  it.each([
    null,
    [],
    {},
    { kind: 'text' },
    { kind: 'text', text: 1 },
    { kind: 'image', text: 'x' },
    { kind: 'text', text: 'x', extra: true },
  ])('rejects malformed text input: %j', (input) => {
    expectCode(() => parseTextTokenInput(input), 'TOKEN_MEASUREMENT_INPUT_INVALID');
  });

  it('does not execute content getters or accept class/inherited fields', () => {
    const getter = vi.fn();
    const input = { kind: 'text' };
    Object.defineProperty(input, 'text', { enumerable: true, get: getter });
    expectCode(() => parseTextTokenInput(input), 'TOKEN_MEASUREMENT_INPUT_INVALID');
    expect(getter).not.toHaveBeenCalled();
    expectCode(
      () => parseTextTokenInput(Object.create(textInput('inherited'))),
      'TOKEN_MEASUREMENT_INPUT_INVALID'
    );
    expectCode(() => parseTextTokenInput(new Date()), 'TOKEN_MEASUREMENT_INPUT_INVALID');
  });

  it('accepts a null-prototype data record without borrowing caller mutation', () => {
    const input: unknown = Object.create(null);
    Object.defineProperties(input, {
      kind: { value: 'text', enumerable: true },
      text: { value: 'original', enumerable: true, writable: true },
    });
    const parsed = parseTextTokenInput(input);
    Object.defineProperty(input, 'text', { value: 'changed' });
    expect(parsed.text).toBe('original');
  });
});

describe('token measurement result protocol', () => {
  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '1',
    null,
    undefined,
    1n,
  ])('rejects invalid count %s', async (tokens) => {
    await expect(
      counterReturning({ tokens, accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT }).measure(
        textInput('x'),
        measurementSignal()
      )
    ).rejects.toMatchObject({ code: 'TOKEN_MEASUREMENT_RESULT_INVALID' });
  });

  it.each([0, 1, Number.MAX_SAFE_INTEGER])(
    'accepts valid count %s, without inventing an empty-input rule',
    async (tokens) => {
      const result = await counterReturning({
        tokens,
        accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
      }).measure(textInput(''), measurementSignal());
      expect(result.tokens).toBe(tokens);
    }
  );

  it.each([
    null,
    [],
    {},
    { tokens: 1 },
    { tokens: 1, accuracy: 'unknown' },
    { tokens: 1, accuracy: 'exact', measurementRef: 'forged' },
    { tokens: 1, accuracy: 'exact', scope: 'request' },
  ])('rejects malformed or forged results: %j', async (result) => {
    await expect(
      counterReturning(result).measure(textInput('x'), measurementSignal())
    ).rejects.toMatchObject({ code: 'TOKEN_MEASUREMENT_RESULT_INVALID' });
  });

  it('rejects accessor results and exposes only fixed error text', async () => {
    const getter = vi.fn();
    const result = { accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT };
    Object.defineProperty(result, 'tokens', { enumerable: true, get: getter });
    await expect(
      counterReturning(result).measure(textInput('private input'), measurementSignal())
    ).rejects.toMatchObject({ code: 'TOKEN_MEASUREMENT_RESULT_INVALID' });
    expect(getter).not.toHaveBeenCalled();
    const cause = new Error('private backend diagnostic');
    const counter = createTokenCounter({
      ...textCounterDefinition(),
      measure: () => Promise.reject(cause),
    });
    const failure = await counter
      .measure(textInput('private input'), measurementSignal())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TokenMeasurementError);
    expect(failure).toMatchObject({ code: 'TOKEN_MEASUREMENT_FAILED', cause });
    expect(failure).toHaveProperty('message', 'Token measurement implementation failed.');
  });

  it('validates detached measurements and checks requirements without converting them', async () => {
    const exact = await createTokenCounter(textCounterDefinition()).measure(
      textInput('x'),
      measurementSignal()
    );
    expect(parseTokenMeasurement(JSON.parse(JSON.stringify(exact)))).toEqual(exact);
    expect(
      requireTokenMeasurement(exact, {
        measurementRef: exact.measurementRef,
        inputProtocolRef: exact.inputProtocolRef,
        scope: TOKEN_MEASUREMENT_SCOPE.TEXT,
        accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
      })
    ).toEqual(exact);
    for (const requirement of [
      { measurementRef: 'other' },
      { inputProtocolRef: 'other' },
      { scope: TOKEN_MEASUREMENT_SCOPE.REQUEST },
      { scope: TOKEN_MEASUREMENT_SCOPE.CONTENT },
      { accuracy: TOKEN_MEASUREMENT_ACCURACY.ESTIMATED },
    ]) {
      expectCode(
        () => requireTokenMeasurement(exact, requirement),
        'TOKEN_MEASUREMENT_REQUIREMENT_UNSATISFIED'
      );
    }
    const estimated = { ...exact, accuracy: TOKEN_MEASUREMENT_ACCURACY.ESTIMATED };
    expectCode(
      () => requireTokenMeasurement(estimated, { accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT }),
      'TOKEN_MEASUREMENT_REQUIREMENT_UNSATISFIED'
    );
    expectCode(
      () => parseTokenMeasurement({ ...exact, extra: true }),
      'TOKEN_MEASUREMENT_RESULT_INVALID'
    );
    const requirements = {};
    Object.defineProperty(requirements, 'accuracy', { value: undefined, enumerable: true });
    expectCode(
      () => requireTokenMeasurement(exact, requirements),
      'TOKEN_MEASUREMENT_REQUIREMENT_INVALID'
    );
  });

  it('contains reflection failures for detached results and requirement getters', async () => {
    const exact = await createTokenCounter(textCounterDefinition()).measure(
      textInput('x'),
      measurementSignal()
    );
    const revoked = Proxy.revocable(exact, {});
    revoked.revoke();
    expectCode(() => parseTokenMeasurement(revoked.proxy), 'TOKEN_MEASUREMENT_RESULT_INVALID');
    const getter = vi.fn();
    const requirements = {};
    Object.defineProperty(requirements, 'scope', { get: getter, enumerable: true });
    expectCode(
      () => requireTokenMeasurement(exact, requirements),
      'TOKEN_MEASUREMENT_REQUIREMENT_INVALID'
    );
    expect(getter).not.toHaveBeenCalled();
    expectCode(
      () => parseTokenMeasurement({ ...exact, scope: 'unknown' }),
      'TOKEN_MEASUREMENT_RESULT_INVALID'
    );
    expectCode(
      () => parseTokenMeasurement({ ...exact, inputProtocolRef: '' }),
      'TOKEN_MEASUREMENT_RESULT_INVALID'
    );
  });

  it('does not inspect opaque thrown values or execute a thrown error code getter', async () => {
    const revoked = Proxy.revocable(new Error('opaque failure'), {});
    revoked.revoke();
    const hostileBinding = new Proxy(textCounterDefinition(), {
      getPrototypeOf() {
        throw revoked.proxy;
      },
    });
    expectCode(() => createTokenCounter(hostileBinding), 'TOKEN_MEASUREMENT_BINDING_INVALID');
    const counter = createTokenCounter({
      ...textCounterDefinition(),
      measure() {
        throw revoked.proxy;
      },
    });
    await expect(counter.measure(textInput('x'), measurementSignal())).rejects.toMatchObject({
      code: 'TOKEN_MEASUREMENT_FAILED',
    });
    const getter = vi.fn();
    const error = new TokenMeasurementError('TOKEN_MEASUREMENT_FAILED', 'Backend failed.');
    Object.defineProperty(error, 'code', { get: getter });
    const accessorError = createTokenCounter({
      ...textCounterDefinition(),
      measure: () => Promise.reject(error),
    });
    await expect(accessorError.measure(textInput('x'), measurementSignal())).rejects.toMatchObject({
      code: 'TOKEN_MEASUREMENT_FAILED',
    });
    expect(getter).not.toHaveBeenCalled();
  });
});
