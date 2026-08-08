import type { AgentIdentity } from '@ta-agent/base-identity';
import type { ContextModelMessage, ProviderModelReference } from '@ta-agent/base-model';
import type {
  BaseAgentContext,
  BaseWorkflowContext,
  StepOverrides,
  WorkflowCondition,
  WorkflowDefinition,
} from '@ta-agent/base-workflow';
import type { SessionBranchId, SessionSnapshot } from '../../types.js';
import type {
  CompactableSessionPort,
  CompactSessionInput,
  SessionCompaction,
  SessionCompactionOutcome,
  SessionCompactionPolicy,
  SessionCompactionRuntime,
  SessionCompactionSource,
} from '../contracts.js';
import type { SessionCompactionStepName } from './names.js';

export interface SessionCompactionResources {
  readonly session: CompactableSessionPort;
  readonly runtime: SessionCompactionRuntime;
  readonly modelReference: ProviderModelReference;
  readonly instructions: string;
  readonly policy: SessionCompactionPolicy;
  readonly clock: () => number;
}

export interface SessionCompactionAgentContext extends BaseAgentContext<
  CompactSessionInput,
  SessionCompactionOutcome
> {
  readonly identity: AgentIdentity;
  readonly resources: SessionCompactionResources;
}

export interface SessionCompactionWorkflowContext extends BaseWorkflowContext<
  SessionCompactionStepName,
  SessionCompactionAgentContext,
  SessionCompactionOutcome
> {
  readonly resources: SessionCompactionResources;
  snapshot?: SessionSnapshot;
  branchId?: SessionBranchId;
  previousCompaction?: SessionCompaction;
  source?: SessionCompactionSource;
  compactedContext?: ContextModelMessage;
}

export type SessionCompactionCondition = WorkflowCondition<SessionCompactionAgentContext>;

export interface CreateSessionCompactionWorkflowOptions extends Omit<
  WorkflowDefinition<
    SessionCompactionStepName,
    SessionCompactionAgentContext,
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
