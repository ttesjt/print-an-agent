import type { ResolvedResponsibility, ResponsibilityRouter } from '@ta-agent/base-actor';
import type { AgentIdentity } from '@ta-agent/base-identity';
import type {
  AssistantModelMessage,
  ContextModelMessage,
  ModelMessage,
  TextTokenInput,
  TokenCounter,
} from '@ta-agent/model-invocation-core';
import type { SessionCompactionRejectionReason } from '../planning/contracts.js';
import type { CompactionMeasurementResources } from '../planning/measurement.js';
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

export interface SessionCompactionResources extends CompactionMeasurementResources {
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
  targetTokens?: number;
  plannerTargetTokens?: number;
  tokenCounter?: TokenCounter<TextTokenInput>;
  attemptIndex?: number;
  attemptMessages?: readonly ModelMessage[];
  candidate?: AssistantModelMessage;
  candidateTokens?: number;
  draft?: string;
  assessment?: SessionCompactionAssessment;
}

export type SessionCompactionAssessment =
  | Readonly<{ status: 'accepted'; actualTokens: number }>
  | Readonly<{
      status: 'rejected';
      reason: SessionCompactionRejectionReason;
      actualTokens?: number;
      cause?: unknown;
    }>;

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
