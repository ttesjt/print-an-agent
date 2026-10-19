import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  type TokenCounter,
  type TextTokenInput,
} from '@ta-agent/model-invocation-core';

/** Test-only vocabulary, not a production estimate. */
export function testCounter(
  count: (text: string) => Promise<number> = (text) => Promise.resolve(text.length)
): TokenCounter<TextTokenInput> {
  return createTokenCounter({
    measurementRef: 'chars',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: async (input) => ({ tokens: await count(input.text), accuracy: 'exact' }),
  });
}
