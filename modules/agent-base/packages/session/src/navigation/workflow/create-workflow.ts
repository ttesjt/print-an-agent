import { Workflow } from '@print-an-agent/workflow-core';
import { AgentSessionError } from '../../errors.js';
import { finalizeSessionExecution } from '../../lifecycle/index.js';
import type { SessionNavigationOutcome } from '../types/outcome.js';
import type { SessionNavigationStepName } from './names.js';
import { SESSION_NAVIGATION_WORKFLOW_NAME } from './names.js';
import { createSessionNavigationStepDefinitions } from './step-definitions.js';
import type {
  CreateSessionNavigationWorkflowOptions,
  SessionNavigationResources,
  SessionNavigationWorkflowInput,
  SessionNavigationWorkflowState,
} from './types.js';

export function createSessionNavigationWorkflow<R extends SessionNavigationResources>(
  options: CreateSessionNavigationWorkflowOptions<R>
): Workflow<
  SessionNavigationStepName,
  SessionNavigationWorkflowInput,
  SessionNavigationWorkflowState,
  R,
  SessionNavigationOutcome | undefined
> {
  return new Workflow({
    ...options,
    name: SESSION_NAVIGATION_WORKFLOW_NAME,
    entryStep: 'runSessionNavigation',
    stepDefinitions: createSessionNavigationStepDefinitions(),
    createSkippedResult: () => undefined,
    createResult(state) {
      if (state.outcome === undefined)
        throw new AgentSessionError(
          'SESSION_NAVIGATION_INVALID',
          'Navigation completed without a result.'
        );
      return state.outcome;
    },
    createState: ({ input, resources }): SessionNavigationWorkflowState => ({
      agentId: input.agentId,
      input: input.navigation,
      resources,
      ...(input.traceEmitter === undefined ? {} : { traceEmitter: input.traceEmitter }),
    }),
    lifecycle: {
      ...options.lifecycle,
      onFinally: (context) =>
        finalizeSessionExecution(context.state, async () => {
          await options.lifecycle?.onFinally?.(context);
        }),
    },
  });
}
