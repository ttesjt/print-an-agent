import { expect, it } from 'vitest';
import {
  RUN_WORKFLOW,
  SKIP_STEP,
  STEP_CARDINALITY,
  skipWorkflow,
} from '@print-an-agent/workflow-core';

it('publishes domain-independent policy values and explicit skip decisions', () => {
  expect(RUN_WORKFLOW).toEqual({ status: 'run' });
  expect(skipWorkflow('nothing to change')).toEqual({
    status: 'skip',
    reason: 'nothing to change',
  });
  expect(typeof SKIP_STEP).toBe('symbol');
  expect(Object.isFrozen(STEP_CARDINALITY)).toBe(true);
});
