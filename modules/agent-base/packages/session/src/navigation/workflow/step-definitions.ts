import type { Step, StepDefinitions } from '@ta-agent/base-workflow';
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
    runSessionNavigation: { step: runSessionNavigation, skippable: false },
    validateSessionNavigation: {
      step: createPlaceholderStep('validateSessionNavigation'),
      skippable: false,
    },
    inspectSessionNavigation: {
      step: createPlaceholderStep('inspectSessionNavigation'),
      skippable: false,
    },
    commitSessionNavigation: {
      step: createPlaceholderStep('commitSessionNavigation'),
      skippable: false,
    },
  });
}
