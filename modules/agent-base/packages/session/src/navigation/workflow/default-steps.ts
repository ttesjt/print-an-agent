import type { StepOverrides } from '@ta-agent/base-workflow';
import {
  commitSessionNavigationState,
  inspectSessionNavigationState,
  validateSessionNavigationState,
} from '../coordinator-internal.js';
import type { SessionNavigationStepName } from './names.js';
import type { SessionNavigationWorkflowContext } from './types.js';

function validateSessionNavigation(context: SessionNavigationWorkflowContext): Promise<void> {
  validateSessionNavigationState(context);
  return Promise.resolve();
}

async function inspectSessionNavigation(context: SessionNavigationWorkflowContext): Promise<void> {
  await inspectSessionNavigationState(context);
}

async function commitSessionNavigation(context: SessionNavigationWorkflowContext): Promise<void> {
  const applied = await commitSessionNavigationState(context);
  const result = context.result;
  if (applied === undefined || result === undefined || result.status === 'inspected') return;
  await context.agentRunContext.traceEmitter?.record({
    type: 'session-navigation-applied',
    workflowName: context.workflowName,
    workflowRunId: context.workflowRunId,
    operation: applied.operation,
    sessionId: result.sessionId,
    selectedBranchId: applied.navigation.selectedBranchId,
    affectedBranchId: applied.affectedBranchId,
    navigationRevision: applied.navigation.revision,
  });
}

export function createDefaultSessionNavigationStepOverrides(): StepOverrides<
  SessionNavigationStepName,
  SessionNavigationWorkflowContext
> {
  return Object.freeze({
    validateSessionNavigation,
    inspectSessionNavigation,
    commitSessionNavigation,
  });
}
