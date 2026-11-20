import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import type { AgentTraceEmitter } from '@print-an-agent/base-observability';
import type { WorkflowContext, WorkflowDefinition } from '@print-an-agent/workflow-core';
import type { SessionNavigationExecutionState } from '../execution/index.js';
import type { NavigateSessionInput } from '../types/command.js';
import type { SessionNavigationOutcome } from '../types/outcome.js';
import type { SessionNavigationCoordinatorPort } from '../types/ports.js';
import type { SessionNavigationStepName } from './names.js';

export interface SessionNavigationResources {
  readonly session: SessionNavigationCoordinatorPort;
}
export interface SessionNavigationWorkflowInput {
  readonly agentId: AgentId;
  readonly navigation: NavigateSessionInput;
  /** Per-invocation correlation; never retained in the Workflow's bound resources. */
  readonly traceEmitter?: AgentTraceEmitter;
}
export interface SessionNavigationWorkflowState extends SessionNavigationExecutionState {
  readonly traceEmitter?: AgentTraceEmitter;
  outcome?: SessionNavigationOutcome;
}
export type SessionNavigationWorkflowContext<
  R extends SessionNavigationResources = SessionNavigationResources,
> = WorkflowContext<SessionNavigationStepName, SessionNavigationWorkflowState, R>;
export type CreateSessionNavigationWorkflowOptions<
  R extends SessionNavigationResources = SessionNavigationResources,
> = Omit<
  WorkflowDefinition<
    SessionNavigationStepName,
    SessionNavigationWorkflowInput,
    SessionNavigationWorkflowState,
    R,
    SessionNavigationOutcome | undefined
  >,
  'name' | 'entryStep' | 'stepDefinitions' | 'createState' | 'createResult' | 'createSkippedResult'
>;
