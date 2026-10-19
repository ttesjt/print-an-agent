import { expect, it, vi } from 'vitest';
import {
  createTokenCounter,
  parseTextTokenInput,
  requireTokenMeasurement,
  TEXT_TOKEN_INPUT_CONTRACT,
  TOKEN_MEASUREMENT_ACCURACY,
  TOKEN_MEASUREMENT_SCOPE,
  TokenMeasurementError,
  type TextTokenInput,
  type TokenInputContract,
} from '../../src/index.js';
import {
  measurementSignal,
  textCounterDefinition,
  textInput,
} from '../support/token-measurement.js';

interface ImageInput {
  readonly kind: 'image';
  readonly width: number;
  readonly height: number;
}
type VisionInput = TextTokenInput | ImageInput;

/** Test-only media protocol. Real media/model semantics belong to their explicit adapter. */
const visionContract: TokenInputContract<VisionInput> = {
  ref: 'test-input:vision-dimensions',
  scope: TOKEN_MEASUREMENT_SCOPE.CONTENT,
  inputKinds: ['text', 'image'],
  parse(input: unknown): VisionInput {
    if (typeof input !== 'object' || input === null) throw new Error('Expected object');
    const kind: unknown = Object.getOwnPropertyDescriptor(input, 'kind')?.value;
    if (kind === 'text') return parseTextTokenInput(input);
    const width: unknown = Object.getOwnPropertyDescriptor(input, 'width')?.value;
    const height: unknown = Object.getOwnPropertyDescriptor(input, 'height')?.value;
    if (
      kind !== 'image' ||
      Reflect.ownKeys(input).length !== 3 ||
      typeof width !== 'number' ||
      !Number.isSafeInteger(width) ||
      width < 1 ||
      typeof height !== 'number' ||
      !Number.isSafeInteger(height) ||
      height < 1
    ) {
      throw new TokenMeasurementError(
        'TOKEN_MEASUREMENT_INPUT_INVALID',
        'Image dimensions are required.'
      );
    }
    return Object.freeze({ kind, width, height });
  },
};

it('counts independently without constructing an Actor, Agent, Session or Workflow', async () => {
  const counter = createTokenCounter(textCounterDefinition());
  const result = await counter.measure(textInput('hello'), measurementSignal());
  expect(
    requireTokenMeasurement(result, {
      measurementRef: 'test:utf16-code-units',
      accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
    }).tokens
  ).toBe(5);
});

it('extends structured input without changing Core or making text-only counters universal', async () => {
  const implementation = vi.fn((input: VisionInput) =>
    Promise.resolve({
      tokens: input.kind === 'text' ? input.text.length : input.width * input.height,
      accuracy:
        input.kind === 'text'
          ? TOKEN_MEASUREMENT_ACCURACY.EXACT
          : TOKEN_MEASUREMENT_ACCURACY.ESTIMATED,
    })
  );
  const counter = createTokenCounter({
    measurementRef: 'test:vision-area-policy',
    inputContract: visionContract,
    measure: implementation,
  });
  expect(await counter.measure(textInput('hello'), measurementSignal())).toMatchObject({
    tokens: 5,
    accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
    scope: TOKEN_MEASUREMENT_SCOPE.CONTENT,
  });
  const media = { kind: 'image', width: 10, height: 20 } as const;
  const result = await counter.measure(media, measurementSignal());
  expect(result).toEqual({
    tokens: 200,
    accuracy: TOKEN_MEASUREMENT_ACCURACY.ESTIMATED,
    scope: TOKEN_MEASUREMENT_SCOPE.CONTENT,
    measurementRef: 'test:vision-area-policy',
    inputProtocolRef: visionContract.ref,
  });
  await expect(
    counter.measure({ kind: 'image', width: 0, height: 20 }, measurementSignal())
  ).rejects.toMatchObject({ code: 'TOKEN_MEASUREMENT_INPUT_INVALID' });
  expect(implementation).toHaveBeenCalledTimes(2);
  const textCounter = createTokenCounter(textCounterDefinition());
  const untypedInput: unknown = Reflect.apply(textCounter.measure, undefined, [
    media,
    measurementSignal(),
  ]);
  await expect(untypedInput).rejects.toMatchObject({ code: 'TOKEN_MEASUREMENT_INPUT_UNSUPPORTED' });
});

it('rejects parser failures and kind substitution before invoking counting code', async () => {
  const implementation = vi.fn(textCounterDefinition().measure);
  const parserFailure = new Error('input parse diagnostic');
  const counter = createTokenCounter({
    ...textCounterDefinition(),
    measure: implementation,
    inputContract: {
      ...TEXT_TOKEN_INPUT_CONTRACT,
      parse() {
        throw parserFailure;
      },
    },
  });
  await expect(counter.measure(textInput('x'), measurementSignal())).rejects.toMatchObject({
    code: 'TOKEN_MEASUREMENT_INPUT_INVALID',
    cause: parserFailure,
  });
  const contract = { ...TEXT_TOKEN_INPUT_CONTRACT };
  Object.defineProperty(contract, 'parse', { value: () => ({ kind: 'image' }) });
  const changedKind = createTokenCounter({
    ...textCounterDefinition(),
    inputContract: contract,
    measure: implementation,
  });
  await expect(changedKind.measure(textInput('x'), measurementSignal())).rejects.toMatchObject({
    code: 'TOKEN_MEASUREMENT_INPUT_INVALID',
  });
  expect(implementation).not.toHaveBeenCalled();
});

it('counts a whole subject through its protocol rather than summing independent fragments', async () => {
  const inputContract = {
    ...TEXT_TOKEN_INPUT_CONTRACT,
    ref: 'test-input:nonadditive-text',
  };
  const counter = createTokenCounter({
    measurementRef: 'test:two-character-tokens',
    inputContract,
    measure: (input) =>
      Promise.resolve({
        tokens: Math.ceil(input.text.length / 2),
        accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
      }),
  });
  const left = await counter.measure(textInput('a'), measurementSignal());
  const right = await counter.measure(textInput('b'), measurementSignal());
  const whole = await counter.measure(textInput('ab'), measurementSignal());
  expect(whole.tokens).toBe(1);
  expect(left.tokens + right.tokens).toBe(2);
});

it('allows a separate whole-request protocol without pretending text measurement covers framing', async () => {
  interface RequestInput {
    readonly kind: 'request';
    readonly text: string;
  }
  const contract: TokenInputContract<RequestInput> = {
    ref: 'test-input:framed-request',
    scope: TOKEN_MEASUREMENT_SCOPE.REQUEST,
    inputKinds: ['request'],
    parse(input) {
      if (typeof input !== 'object' || input === null) throw new Error('Expected request');
      const text: unknown = Object.getOwnPropertyDescriptor(input, 'text')?.value;
      if (typeof text !== 'string' || Reflect.ownKeys(input).length !== 2)
        throw new Error('Expected request text');
      return Object.freeze({ kind: 'request', text });
    },
  };
  const counter = createTokenCounter({
    measurementRef: 'test:request-framing',
    inputContract: contract,
    measure: (input) =>
      Promise.resolve({
        tokens: `<request>${input.text}</request>`.length,
        accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
      }),
  });
  const result = await counter.measure({ kind: 'request', text: 'x' }, measurementSignal());
  expect(
    requireTokenMeasurement(result, { scope: TOKEN_MEASUREMENT_SCOPE.REQUEST }).tokens
  ).toBeGreaterThan(1);
  expect(() => requireTokenMeasurement(result, { scope: TOKEN_MEASUREMENT_SCOPE.TEXT })).toThrow(
    TokenMeasurementError
  );
});
