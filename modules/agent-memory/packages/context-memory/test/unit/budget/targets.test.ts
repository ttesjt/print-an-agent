import { expect, it } from 'vitest';
import { resolveCompactionTarget, resolveMemoryConfig } from '@print-an-agent/context-memory';

const config = () => resolveMemoryConfig({ measurementRef: 'counter:v1' });

it('resolves direct/calculated targets without relaxing authority', () => {
  expect(resolveCompactionTarget(config())).toBe(3276);
  expect(resolveCompactionTarget(config(), { maxTokens: 3000 })).toBe(3000);
  expect(
    resolveCompactionTarget(config(), { limitTokens: 4096, ratio: 0.8, reserveTokens: 128 })
  ).toBe(3148);
  expect(() => resolveCompactionTarget(config(), { maxTokens: 5000 })).toThrow();
  expect(() =>
    resolveCompactionTarget(
      resolveMemoryConfig({ measurementRef: 'counter', maxContextTokens: null })
    )
  ).toThrow();
});
