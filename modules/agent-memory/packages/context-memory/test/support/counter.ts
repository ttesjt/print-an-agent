import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  type TokenCounter,
  type TextTokenInput,
} from '@ta-agent/model-invocation-core';

/** Test-only vocabulary: one token per UTF-16 code unit. */
export function testCounter(
  ref = 'chars',
  count: (text: string) => Promise<number> = (text) => Promise.resolve(text.length)
): TokenCounter<TextTokenInput> {
  return createTokenCounter({
    measurementRef: ref,
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: async (input) => ({ tokens: await count(input.text), accuracy: 'exact' }),
  });
}
