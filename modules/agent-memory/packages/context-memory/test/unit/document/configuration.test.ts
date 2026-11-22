import { expect, it } from 'vitest';
import { resolveMemoryConfig } from '@print-an-agent/context-memory';
import { errorCode } from '../../support/errors.js';

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
