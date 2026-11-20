import { expect, it } from 'vitest';
import { SKIP_STEP, STEP_CARDINALITY } from '@print-an-agent/workflow-core';

it('publishes the shared Step policy values', () => {
  expect(typeof SKIP_STEP).toBe('symbol');
  expect(Object.isFrozen(STEP_CARDINALITY)).toBe(true);
});
