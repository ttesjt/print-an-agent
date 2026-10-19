import { createTokenCounter, TEXT_TOKEN_INPUT_CONTRACT } from '@ta-agent/model-invocation-core';

/** Test vocabulary: one token per UTF-16 code unit; never a production model estimate. */
export function testCompactionCounter(
  count: (text: string, signal: AbortSignal) => Promise<number> = (text) =>
    Promise.resolve(text.length)
) {
  return createTokenCounter({
    measurementRef: 'test:utf16-code-units',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: async (input, signal) => ({
      tokens: await count(input.text, signal),
      accuracy: 'exact',
    }),
  });
}
export const TEST_COMPACTION_TOKEN_COUNTER = testCompactionCounter();
