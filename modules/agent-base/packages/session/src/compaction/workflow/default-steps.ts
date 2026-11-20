import type { StepOverrides } from '@print-an-agent/workflow-core';
import type { SessionCompactionStepName } from './names.js';
import {
  buildCompactedContext,
  generateCompactionCandidate,
  measureCompactionCandidate,
  prepareCompactionAttempt,
  refineCompactionPlan,
  validateCompactionCandidate,
} from './steps/build-compacted-context/index.js';
import { inspectSession } from './steps/inspect-session.js';
import { persistCompaction } from './steps/persist-compaction.js';
import { resolveCompactionActor } from './steps/resolve-compaction-actor.js';
import { resolveCompactionTarget } from './steps/resolve-compaction-target.js';
import { resolveCompactionTokenCounter } from './steps/resolve-compaction-token-counter.js';
import { selectCompactionSource } from './steps/select-compaction-source.js';
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
