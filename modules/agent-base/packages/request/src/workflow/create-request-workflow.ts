import { createWorkflow, type AnyAgentRunContext, type Workflow } from '@ta-agent/base-workflow';
import { REQUEST_WORKFLOW_NAME, type RequestStepName } from './names.js';
import { createRequestStepDefinitions } from './step-definitions.js';
import type { RequestWorkflowContext, RequestWorkflowOptions } from './types.js';

export function createRequestWorkflow<
  C extends AnyAgentRunContext,
  TResult,
  WC extends RequestWorkflowContext<C, TResult>,
>(options: RequestWorkflowOptions<C, WC, TResult>): Workflow<RequestStepName, C, WC, TResult> {
  return createWorkflow({
    ...options,
    name: REQUEST_WORKFLOW_NAME,
    entryStep: 'runRequest',
    stepDefinitions: createRequestStepDefinitions<C, TResult, WC>(),
  });
}
