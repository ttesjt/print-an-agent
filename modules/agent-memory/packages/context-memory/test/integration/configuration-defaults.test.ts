import { expect, it } from 'vitest';
import {
  DEFAULT_EXECUTION_POLICY,
  resolveExecutionPolicy,
  resolveMemoryConfig,
} from '@print-an-agent/context-memory';
import { errorCode } from '../support/errors.js';

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
