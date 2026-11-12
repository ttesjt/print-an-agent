import { STEP_CARDINALITY, type Step, type StepDefinitions } from '@print-an-agent/workflow-core';
import { SessionNavigationStepNotImplementedError } from '../../errors.js';
import type { SessionNavigationLeafStepName, SessionNavigationStepName } from './names.js';
import type { SessionNavigationWorkflowContext } from './types.js';

function createPlaceholderStep(
  stepName: SessionNavigationLeafStepName
): Step<SessionNavigationWorkflowContext> {
  return () => Promise.reject(new SessionNavigationStepNotImplementedError(stepName));
}

const runSessionNavigation: Step<SessionNavigationWorkflowContext> = async (context) => {
  const steps: readonly SessionNavigationLeafStepName[] = [
    'validateSessionNavigation',
    'inspectSessionNavigation',
    'commitSessionNavigation',
  ];
  for (const stepName of steps) await context.runStep(stepName);
};

export function createSessionNavigationStepDefinitions(): StepDefinitions<
  SessionNavigationStepName,
  SessionNavigationWorkflowContext
> {
  return Object.freeze({
    runSessionNavigation: {
      step: runSessionNavigation,
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    validateSessionNavigation: {
      step: createPlaceholderStep('validateSessionNavigation'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    inspectSessionNavigation: {
      step: createPlaceholderStep('inspectSessionNavigation'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    commitSessionNavigation: {
      step: createPlaceholderStep('commitSessionNavigation'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
  });
}
