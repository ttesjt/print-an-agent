import { expect, it } from 'vitest';
import { historyChainLimit } from '../../../../src/database/history/storage-policy.js';

it('validates explicit chain limits instead of silently accepting invalid settings', () => {
  expect(historyChainLimit()).toBe(32);
  expect(historyChainLimit({ maxDeltaChain: 1 })).toBe(1);
  for (const maxDeltaChain of [0, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(() => historyChainLimit({ maxDeltaChain })).toThrow();
  // @ts-expect-error JavaScript configuration can supply null; it is not an omitted setting.
  expect(() => historyChainLimit({ maxDeltaChain: null })).toThrow();
});
