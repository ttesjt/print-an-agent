import { Workflow, type WorkflowContext } from '@print-an-agent/workflow-core';
import { AgentRequestError } from '../errors.js';
import { REQUEST_WORKFLOW_NAME, type RequestStepName } from './names.js';
import { createRequestStepDefinitions } from './step-definitions.js';
import type { RequestWorkflowOptions, RequestWorkflowStateView } from './types.js';

export function createRequestWorkflow<
  I,
  S extends RequestWorkflowStateView<O>,
  R,
  O = S['completedResponse'],
>(options: RequestWorkflowOptions<I, S, R, O>): Workflow<RequestStepName, I, S, R, O | undefined> {
  return new Workflow({
    ...options,
    name: REQUEST_WORKFLOW_NAME,
    entryStep: 'runRequest',
    stepDefinitions: createRequestStepDefinitions<WorkflowContext<RequestStepName, S, R>>(),
    createSkippedResult: () => undefined,
    createResult(state) {
      if (state.completedResponse === undefined)
        throw new AgentRequestError(
          'REQUEST_OUTPUT_STATE_INVALID',
          'Request Workflow completed without a response.'
        );
      return state.completedResponse;
    },
  });
}
