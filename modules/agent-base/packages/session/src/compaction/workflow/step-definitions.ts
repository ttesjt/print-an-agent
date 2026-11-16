import { STEP_CARDINALITY, type Step, type StepDefinitions } from '@print-an-agent/workflow-core';
import { SessionCompactionStepNotImplementedError } from '../../errors.js';
import type { SessionCompactionLeafStepName, SessionCompactionStepName } from './names.js';
import type { SessionCompactionWorkflowContext } from './types.js';
import { buildCompactedContext } from './composites.js';

function createPlaceholderStep(
  stepName: SessionCompactionLeafStepName
): Step<SessionCompactionWorkflowContext> {
  return () => Promise.reject(new SessionCompactionStepNotImplementedError(stepName));
}

const runSessionCompaction: Step<SessionCompactionWorkflowContext> = async (context) => {
  const steps: readonly SessionCompactionStepName[] = [
    'inspectSession',
    'selectCompactionSource',
    'resolveCompactionTarget',
    'resolveCompactionTokenCounter',
    'resolveCompactionActor',
    'buildCompactedContext',
    'persistCompaction',
  ];
  for (const stepName of steps) {
    await context.runStep(stepName);
    if (context.state.outcome !== undefined) return;
  }
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
      step: buildCompactedContext,
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    resolveCompactionTarget: {
      step: createPlaceholderStep('resolveCompactionTarget'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    resolveCompactionTokenCounter: {
      step: createPlaceholderStep('resolveCompactionTokenCounter'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    resolveCompactionActor: {
      step: createPlaceholderStep('resolveCompactionActor'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
    prepareCompactionAttempt: {
      step: createPlaceholderStep('prepareCompactionAttempt'),
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: false,
    },
    generateCompactionCandidate: {
      step: createPlaceholderStep('generateCompactionCandidate'),
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: false,
    },
    measureCompactionCandidate: {
      step: createPlaceholderStep('measureCompactionCandidate'),
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: false,
    },
    validateCompactionCandidate: {
      step: createPlaceholderStep('validateCompactionCandidate'),
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: false,
    },
    refineCompactionPlan: {
      step: createPlaceholderStep('refineCompactionPlan'),
      cardinality: STEP_CARDINALITY.REPEATABLE,
      skippable: false,
    },
    persistCompaction: {
      step: createPlaceholderStep('persistCompaction'),
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
    },
  });
}
