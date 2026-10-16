import { Workflow } from '@ta-agent/workflow-core';
import { finalizeSessionExecution } from '../../lifecycle/workflow-execution.js';
import { AgentSessionError } from '../../errors.js';
import { SESSION_NAVIGATION_WORKFLOW_NAME } from './names.js';
import { createSessionNavigationStepDefinitions } from './step-definitions.js';
import type { CreateSessionNavigationWorkflowOptions } from './types.js';

export function createSessionNavigationWorkflow(options: CreateSessionNavigationWorkflowOptions) {
  return new Workflow({
    ...options,
    name: SESSION_NAVIGATION_WORKFLOW_NAME,
    entryStep: 'runSessionNavigation',
    stepDefinitions: createSessionNavigationStepDefinitions(),
    createResult: () => undefined,
    createState: ({ input, resources }) => ({
      agentId: input.agentId,
      input: input.navigation,
      resources,
    }),
    lifecycle: {
      ...options.lifecycle,
      async onSuccess(context) {
        await options.lifecycle?.onSuccess?.(context);
        if (context.result === undefined)
          throw new AgentSessionError(
            'SESSION_NAVIGATION_INVALID',
            'Navigation completed without a result.'
          );
      },
      onFinally: (context) =>
        finalizeSessionExecution(context.state, async () => {
          await options.lifecycle?.onFinally?.(context);
        }),
    },
  });
}
