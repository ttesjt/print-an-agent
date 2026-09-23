import { createWorkflow, type Workflow } from '@ta-agent/base-workflow';
import { finalizeSessionExecution } from '../../lifecycle/workflow-execution.js';
import type { SessionCompactionOutcome } from '../contracts.js';
import { SESSION_COMPACTION_WORKFLOW_NAME, type SessionCompactionStepName } from './names.js';
import { createSessionCompactionStepDefinitions } from './step-definitions.js';
import type {
  CreateSessionCompactionWorkflowOptions,
  SessionCompactionAgentRunContext,
  SessionCompactionWorkflowContext,
} from './types.js';

export function createSessionCompactionWorkflow(
  options: CreateSessionCompactionWorkflowOptions
): Workflow<
  SessionCompactionStepName,
  SessionCompactionAgentRunContext,
  SessionCompactionWorkflowContext,
  SessionCompactionOutcome
> {
  return createWorkflow<
    SessionCompactionStepName,
    SessionCompactionAgentRunContext,
    SessionCompactionWorkflowContext,
    SessionCompactionOutcome
  >({
    ...options,
    lifecycle: {
      ...options.lifecycle,
      onFinally: (context) => finalizeSessionExecution(context, options.lifecycle?.onFinally),
    },
    name: SESSION_COMPACTION_WORKFLOW_NAME,
    entryStep: 'runSessionCompaction',
    stepDefinitions: createSessionCompactionStepDefinitions(),
    createContext: (base): SessionCompactionWorkflowContext => ({
      ...base,
      resources: options.resources,
    }),
    applyResult: (agentRunContext: SessionCompactionAgentRunContext, result) => {
      agentRunContext.output = result;
      return Promise.resolve();
    },
  });
}
