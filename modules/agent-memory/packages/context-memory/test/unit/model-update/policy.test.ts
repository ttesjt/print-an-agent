import { expect, it } from 'vitest';
import { resolveExecutionPolicy } from '@print-an-agent/context-memory';

it.each([
  { maxCompactionPasses: -1 },
  { retrySafetyFactor: 0 },
  { minPlannerTargetTokens: 0 },
  { timeoutMs: NaN },
])('rejects invalid execution policy %s', (input) => {
  expect(() => resolveExecutionPolicy(input)).toThrow();
});
