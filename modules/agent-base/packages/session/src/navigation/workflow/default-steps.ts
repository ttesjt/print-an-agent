import type { StepOverrides } from '@print-an-agent/workflow-core';
import {
  commitSessionNavigationState,
  inspectSessionNavigationState,
  validateSessionNavigationState,
} from '../coordinator-internal.js';
import type { SessionNavigationStepName } from './names.js';
import type { SessionNavigationWorkflowContext } from './types.js';

export function createDefaultSessionNavigationStepOverrides(): StepOverrides<
  SessionNavigationStepName,
  SessionNavigationWorkflowContext
> {
  return {
    validateSessionNavigation(context) {
      validateSessionNavigationState(context.state, context.signal);
      return Promise.resolve();
    },
    async inspectSessionNavigation(context) {
      if (context.state.outcome !== undefined) return;
      const inspected = await inspectSessionNavigationState(context.state, context.signal);
      if (inspected !== undefined) context.state.outcome = inspected;
    },
    async commitSessionNavigation(context) {
      if (context.state.outcome !== undefined) return;
      const committed = await commitSessionNavigationState(context.state, context.signal);
      if (committed === undefined) return;
      const { applied, result } = committed;
      context.state.outcome = result;
      await context.state.traceEmitter?.record({
        type: 'session-navigation-applied',
        workflowName: context.workflowName,
        workflowRunId: context.workflowRunId,
        operation: applied.operation,
        sessionId: result.sessionId,
        selectedBranchId: applied.navigation.selectedBranchId,
        affectedBranchId: applied.affectedBranchId,
        navigationRevision: applied.navigation.revision,
      });
    },
  };
}
