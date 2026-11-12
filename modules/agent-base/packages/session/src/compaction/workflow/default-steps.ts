import type { StepOverrides } from '@print-an-agent/workflow-core';
import { buildCompactedContext } from './composites.js';
import {
  inspectSession,
  selectCompactionSource,
  resolveCompactionTarget,
  resolveCompactionTokenCounter,
  persistCompaction,
} from './session-steps.js';
import { generateCompactionCandidate, resolveCompactionActor } from './generation-steps.js';
import {
  prepareCompactionAttempt,
  measureCompactionCandidate,
  validateCompactionCandidate,
  refineCompactionPlan,
} from './candidate-steps.js';
import type { SessionCompactionStepName } from './names.js';
import type { SessionCompactionWorkflowContext } from './types.js';

export function createDefaultSessionCompactionStepOverrides(): StepOverrides<
  SessionCompactionStepName,
  SessionCompactionWorkflowContext
> {
  return Object.freeze({
    inspectSession,
    selectCompactionSource,
    resolveCompactionTarget,
    resolveCompactionTokenCounter,
    resolveCompactionActor,
    buildCompactedContext,
    prepareCompactionAttempt,
    generateCompactionCandidate,
    measureCompactionCandidate,
    validateCompactionCandidate,
    refineCompactionPlan,
    persistCompaction,
  });
}
