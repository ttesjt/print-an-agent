import { expect, it } from 'vitest';
import {
  RUN_WORKFLOW,
  SKIP_STEP,
  STEP_CARDINALITY,
  skipWorkflow,
  Workflow,
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

it.each([{ createResult: undefined }, { createSkippedResult: 'invalid' }])(
  'rejects a malformed result factory during assembly: %j',
  (invalid) => {
    try {
      Reflect.construct(Workflow, [
        {
          name: 'invalid-projection',
          resources: undefined,
          entryStep: 'main',
          stepDefinitions: {
            main: {
              step: () => Promise.resolve(),
              skippable: false,
              cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
            },
          },
          createState: () => undefined,
          createResult: () => undefined,
          ...invalid,
        },
      ]);
    } catch (error) {
      expect(error).toMatchObject({ code: 'WORKFLOW_RESULT_FACTORY_INVALID' });
      return;
    }
    throw new Error('Expected Workflow assembly to reject the malformed factory.');
  }
);
