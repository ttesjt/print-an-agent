import type { Step, StepDefinitions } from '@ta-agent/base-workflow';
import { SessionCompactionStepNotImplementedError } from '../../errors.js';
import type { SessionCompactionLeafStepName, SessionCompactionStepName } from './names.js';
import type { SessionCompactionWorkflowContext } from './types.js';

function createPlaceholderStep(
  stepName: SessionCompactionLeafStepName
): Step<SessionCompactionWorkflowContext> {
  return () => Promise.reject(new SessionCompactionStepNotImplementedError(stepName));
}

const runSessionCompaction: Step<SessionCompactionWorkflowContext> = async (context) => {
  const steps: readonly SessionCompactionLeafStepName[] = [
    'inspectSession',
    'selectCompactionSource',
    'buildCompactedContext',
    'persistCompaction',
  ];
  for (const stepName of steps) await context.runStep(stepName);
};

export function createSessionCompactionStepDefinitions(): StepDefinitions<
  SessionCompactionStepName,
  SessionCompactionWorkflowContext
> {
  return Object.freeze({
    runSessionCompaction: { step: runSessionCompaction, skippable: false },
    inspectSession: {
      step: createPlaceholderStep('inspectSession'),
      skippable: false,
    },
    selectCompactionSource: {
      step: createPlaceholderStep('selectCompactionSource'),
      skippable: false,
    },
    buildCompactedContext: {
      step: createPlaceholderStep('buildCompactedContext'),
      skippable: false,
    },
    persistCompaction: {
      step: createPlaceholderStep('persistCompaction'),
      skippable: false,
    },
  });
}
