import type { Step } from '@print-an-agent/workflow-core';
import type { SessionCompactionStepName } from './names.js';
import type { SessionCompactionWorkflowContext } from './types.js';

export const runSessionCompaction: Step<SessionCompactionWorkflowContext> = async (context) => {
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
