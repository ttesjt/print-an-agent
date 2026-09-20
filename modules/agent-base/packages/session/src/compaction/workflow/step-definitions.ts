import { STEP_CARDINALITY, type Step, type StepDefinitions } from '@ta-agent/base-workflow';
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
    runSessionCompaction: {
      step: runSessionCompaction,
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    inspectSession: {
      step: createPlaceholderStep('inspectSession'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    selectCompactionSource: {
      step: createPlaceholderStep('selectCompactionSource'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    buildCompactedContext: {
      step: createPlaceholderStep('buildCompactedContext'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    persistCompaction: {
      step: createPlaceholderStep('persistCompaction'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
  });
}
