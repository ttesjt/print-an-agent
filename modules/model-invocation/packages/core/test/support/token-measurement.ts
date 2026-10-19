import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  TOKEN_MEASUREMENT_ACCURACY,
  type TextTokenInput,
  type TokenCounterDefinition,
} from '../../src/index.js';

/** Test vocabulary only: each UTF-16 code unit is one token, not a model estimate. */
export function textCounterDefinition(): TokenCounterDefinition<TextTokenInput> {
  return {
    measurementRef: 'test:utf16-code-units',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: (input) =>
      Promise.resolve({
        tokens: input.text.length,
        accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
      }),
  };
}

export function counterReturning(result: unknown) {
  const definition = textCounterDefinition();
  // An untyped SPI can return values that TypeScript consumers cannot construct.
  Object.defineProperty(definition, 'measure', { value: () => Promise.resolve(result) });
  return createTokenCounter(definition);
}

export const textInput = (text: string): TextTokenInput => ({ kind: 'text', text });
export const measurementSignal = (): AbortSignal => new AbortController().signal;
