import type { ResolvedResponsibility, ResponsibilityRouter } from '@ta-agent/base-actor';
import type { AgentIdentity } from '@ta-agent/base-identity';
import type { ContextModelMessage } from '@ta-agent/base-model';
import type {
  BaseAgentRunContext,
  BaseWorkflowContext,
  StepOverrides,
  WorkflowCondition,
  WorkflowDefinition,
} from '@ta-agent/base-workflow';
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
  readonly resources: SessionCompactionResources;
}

export interface SessionCompactionWorkflowContext extends BaseWorkflowContext<
  SessionCompactionStepName,
  SessionCompactionAgentRunContext,
  SessionCompactionOutcome
> {
  readonly resources: SessionCompactionResources;
  snapshot?: SessionSnapshot;
  execution?: SessionExecutionLease;
  branchId?: SessionBranchId;
  previousCompaction?: SessionCompaction;
  source?: SessionCompactionSource;
  responsibility?: ResolvedResponsibility;
  compactedContext?: ContextModelMessage;
}

export type SessionCompactionCondition = WorkflowCondition<SessionCompactionAgentRunContext>;

export interface CreateSessionCompactionWorkflowOptions extends Omit<
  WorkflowDefinition<
    SessionCompactionStepName,
    SessionCompactionAgentRunContext,
    SessionCompactionWorkflowContext,
    SessionCompactionOutcome
  >,
  'name' | 'entryStep' | 'stepDefinitions' | 'createContext' | 'applyResult'
> {
  readonly resources: SessionCompactionResources;
  readonly stepOverrides?: StepOverrides<
    SessionCompactionStepName,
    SessionCompactionWorkflowContext
  >;
}
