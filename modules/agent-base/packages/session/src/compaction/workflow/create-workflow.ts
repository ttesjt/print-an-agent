import { createWorkflow, type Workflow } from '@ta-agent/base-workflow';
import type { SessionCompactionOutcome } from '../contracts.js';
import { SESSION_COMPACTION_WORKFLOW_NAME, type SessionCompactionStepName } from './names.js';
import { createSessionCompactionStepDefinitions } from './step-definitions.js';
import type {
  CreateSessionCompactionWorkflowOptions,
  SessionCompactionAgentContext,
  SessionCompactionWorkflowContext,
} from './types.js';

export function createSessionCompactionWorkflow(
  options: CreateSessionCompactionWorkflowOptions
): Workflow<
  SessionCompactionStepName,
  SessionCompactionAgentContext,
  SessionCompactionWorkflowContext,
  SessionCompactionOutcome
> {
  return createWorkflow<
    SessionCompactionStepName,
    SessionCompactionAgentContext,
    SessionCompactionWorkflowContext,
    SessionCompactionOutcome
  >({
    ...options,
    name: SESSION_COMPACTION_WORKFLOW_NAME,
    entryStep: 'runSessionCompaction',
    stepDefinitions: createSessionCompactionStepDefinitions(),
    createContext: (base): SessionCompactionWorkflowContext => ({
      ...base,
      resources: options.resources,
    }),
    applyResult: (agentContext: SessionCompactionAgentContext, result) => {
      agentContext.output = result;
      return Promise.resolve();
    },
  });
}
