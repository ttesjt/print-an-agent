import { createWorkflow, type Workflow } from '@ta-agent/base-workflow';
import { finalizeSessionExecution } from '../../lifecycle/workflow-execution.js';
import type { SessionNavigationOutcome } from '../contracts.js';
import { SESSION_NAVIGATION_WORKFLOW_NAME, type SessionNavigationStepName } from './names.js';
import { createSessionNavigationStepDefinitions } from './step-definitions.js';
import type {
  CreateSessionNavigationWorkflowOptions,
  SessionNavigationAgentRunContext,
  SessionNavigationWorkflowContext,
} from './types.js';

export function createSessionNavigationWorkflow(
  options: CreateSessionNavigationWorkflowOptions
): Workflow<
  SessionNavigationStepName,
  SessionNavigationAgentRunContext,
  SessionNavigationWorkflowContext,
  SessionNavigationOutcome
> {
  return createWorkflow<
    SessionNavigationStepName,
    SessionNavigationAgentRunContext,
    SessionNavigationWorkflowContext,
    SessionNavigationOutcome
  >({
    ...options,
    lifecycle: {
      ...options.lifecycle,
      onFinally: (context) => finalizeSessionExecution(context, options.lifecycle?.onFinally),
    },
    name: SESSION_NAVIGATION_WORKFLOW_NAME,
    entryStep: 'runSessionNavigation',
    stepDefinitions: createSessionNavigationStepDefinitions(),
    createContext: (base): SessionNavigationWorkflowContext => ({
      ...base,
      resources: options.resources,
    }),
    applyResult: (agentRunContext, result) => {
      agentRunContext.output = result;
      return Promise.resolve();
    },
  });
}
