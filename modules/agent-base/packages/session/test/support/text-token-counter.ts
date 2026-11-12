import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';

/** Test-only text vocabulary, not a model estimate. */
export function testTextCounter(
  count: (text: string) => Promise<number> = (text) => Promise.resolve(text.length),
  measurementRef = 'test:utf16'
) {
  return createTokenCounter({
    measurementRef,
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: async (input) => ({ tokens: await count(input.text), accuracy: 'exact' }),
  });
}
