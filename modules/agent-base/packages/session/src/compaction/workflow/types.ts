import type { ResolvedResponsibility, ResponsibilityRouter } from '@ta-agent/base-actor';
import type { AgentIdentity } from '@ta-agent/base-identity';
import type { ContextModelMessage } from '@ta-agent/model-invocation-core';
import type { BaseAgentRunContext } from '@ta-agent/base-runtime';
import type { WorkflowContext, WorkflowDefinition } from '@ta-agent/workflow-core';
import type { SessionBranchId, SessionSnapshot } from '../../types.js';
import type { SessionExecutionLease } from '../../lifecycle/execution.js';
import type {
  CompactableSessionPort,
  CompactSessionInput,
  SessionCompaction,
  SessionCompactionOutcome,
  SessionCompactionPolicy,
  SessionCompactionSource,
} from '../contracts.js';
import type { SessionCompactionStepName } from './names.js';

export interface SessionCompactionResources {
  readonly session: CompactableSessionPort;
  readonly responsibilities: ResponsibilityRouter;
  readonly instructions: string;
  readonly policy: SessionCompactionPolicy;
  readonly clock: () => number;
}

export interface SessionCompactionAgentRunContext extends BaseAgentRunContext<
  CompactSessionInput,
  SessionCompactionOutcome
> {
  readonly identity: AgentIdentity;
}

export type SessionCompactionWorkflowContext = WorkflowContext<
  SessionCompactionStepName,
  SessionCompactionAgentRunContext,
  SessionCompactionState,
  SessionCompactionResources,
  SessionCompactionOutcome | undefined
>;
export interface SessionCompactionState {
  snapshot?: SessionSnapshot;
  execution?: SessionExecutionLease;
  branchId?: SessionBranchId;
  previousCompaction?: SessionCompaction;
  source?: SessionCompactionSource;
  responsibility?: ResolvedResponsibility;
  compactedContext?: ContextModelMessage;
}

export type SessionCompactionDefinition = WorkflowDefinition<
  SessionCompactionStepName,
  SessionCompactionAgentRunContext,
  SessionCompactionState,
  SessionCompactionResources,
  SessionCompactionOutcome | undefined
>;
export type SessionCompactionCondition = NonNullable<SessionCompactionDefinition['condition']>;
export type CreateSessionCompactionWorkflowOptions = Omit<
  SessionCompactionDefinition,
  'name' | 'entryStep' | 'stepDefinitions' | 'createState' | 'createResult'
>;
