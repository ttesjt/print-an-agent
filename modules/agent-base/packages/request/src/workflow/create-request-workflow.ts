import { Workflow, type WorkflowContext } from '@print-an-agent/workflow-core';
import { AgentRequestError } from '../errors.js';
import { REQUEST_WORKFLOW_NAME, type RequestStepName } from './names.js';
import { createRequestStepDefinitions } from './step-definitions.js';
import type { RequestWorkflowOptions, RequestWorkflowStateView } from './types.js';

export function createRequestWorkflow<I, S extends RequestWorkflowStateView, R, O>(
  options: RequestWorkflowOptions<I, S, R, O>
): Workflow<RequestStepName, I, S, R, O | undefined> {
  return new Workflow({
    ...options,
    name: REQUEST_WORKFLOW_NAME,
    entryStep: 'runRequest',
    stepDefinitions:
      createRequestStepDefinitions<WorkflowContext<RequestStepName, S, R, O | undefined>>(),
    createResult: () => undefined,
    lifecycle: {
      ...options.lifecycle,
      async onSuccess(context) {
        await options.lifecycle?.onSuccess?.(context);
        if (context.result === undefined) {
          throw new AgentRequestError(
            'REQUEST_OUTPUT_STATE_INVALID',
            'Request Workflow completed without a response.'
          );
        }
      },
    },
  });
}
