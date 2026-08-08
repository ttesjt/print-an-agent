import { createWorkflow, type Workflow } from '@ta-agent/base-workflow';
import type { SessionNavigationOutcome } from '../contracts.js';
import { SESSION_NAVIGATION_WORKFLOW_NAME, type SessionNavigationStepName } from './names.js';
import { createSessionNavigationStepDefinitions } from './step-definitions.js';
import type {
  CreateSessionNavigationWorkflowOptions,
  SessionNavigationAgentContext,
  SessionNavigationWorkflowContext,
} from './types.js';

export function createSessionNavigationWorkflow(
  options: CreateSessionNavigationWorkflowOptions
): Workflow<
  SessionNavigationStepName,
  SessionNavigationAgentContext,
  SessionNavigationWorkflowContext,
  SessionNavigationOutcome
> {
  return createWorkflow<
    SessionNavigationStepName,
    SessionNavigationAgentContext,
    SessionNavigationWorkflowContext,
    SessionNavigationOutcome
  >({
    ...options,
    name: SESSION_NAVIGATION_WORKFLOW_NAME,
    entryStep: 'runSessionNavigation',
    stepDefinitions: createSessionNavigationStepDefinitions(),
    createContext: (base): SessionNavigationWorkflowContext => ({
      ...base,
      resources: options.resources,
    }),
    applyResult: (agentContext, result) => {
      agentContext.output = result;
      return Promise.resolve();
    },
  });
}
