import type { AgentId } from '@print-an-agent/base-identity';
import type { AgentTraceEmitter } from '@print-an-agent/base-observability';
import type { WorkflowContext, WorkflowDefinition } from '@print-an-agent/workflow-core';
import type {
  NavigateSessionInput,
  NavigableSessionPort,
  SessionNavigationOutcome,
} from '../contracts.js';
import type { SessionNavigationExecutionState } from '../coordinator-internal.js';
import type { SessionNavigationStepName } from './names.js';

export interface SessionNavigationResources {
  readonly session: NavigableSessionPort;
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
export type SessionNavigationWorkflowContext = WorkflowContext<
  SessionNavigationStepName,
  SessionNavigationWorkflowState,
  SessionNavigationResources
>;
export type CreateSessionNavigationWorkflowOptions = Omit<
  WorkflowDefinition<
    SessionNavigationStepName,
    SessionNavigationWorkflowInput,
    SessionNavigationWorkflowState,
    SessionNavigationResources,
    SessionNavigationOutcome | undefined
  >,
  'name' | 'entryStep' | 'stepDefinitions' | 'createState' | 'createResult' | 'createSkippedResult'
>;
