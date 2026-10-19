import { expect, it } from 'vitest';
import {
  DEFAULT_EXECUTION_POLICY,
  resolveCompactionTarget,
  resolveExecutionPolicy,
  resolveMemoryConfig,
} from '@ta-agent/context-memory';
import { errorCode } from './support/errors.js';

const config = () => resolveMemoryConfig({ measurementRef: 'counter:v1' });
it('centralizes defaults without choosing a fake model tokenizer', () => {
  expect(errorCode(() => resolveMemoryConfig())).toBe('CONFIG_INVALID');
  expect(config()).toMatchObject({
    maxContextTokens: 4096,
    render: { format: 'text', separator: '\n' },
    maxItems: null,
  });
  expect(resolveExecutionPolicy()).toEqual(DEFAULT_EXECUTION_POLICY);
  expect(
    resolveExecutionPolicy({
      maxCompactionPasses: 0,
      maxConflictRetries: null,
      retrySafetyFactor: 0.7,
    })
  ).toMatchObject({ maxCompactionPasses: 0, maxConflictRetries: null, retrySafetyFactor: 0.7 });
});
it.each([
  { maxContextTokens: 0 },
  { maxContextTokens: undefined },
  { render: { format: 'json', separator: '\n' } },
  { compactionTarget: { maxTokens: 2, ratio: 0.8 } },
])('rejects invalid config %s', (input) => {
  expect(errorCode(() => resolveMemoryConfig({ measurementRef: 'counter', ...input }))).toBe(
    'CONFIG_INVALID'
  );
});
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
it.each([
  { maxCompactionPasses: -1 },
  { retrySafetyFactor: 0 },
  { minPlannerTargetTokens: 0 },
  { timeoutMs: NaN },
])('rejects invalid execution policy %s', (input) => {
  expect(() => resolveExecutionPolicy(input)).toThrow();
});
