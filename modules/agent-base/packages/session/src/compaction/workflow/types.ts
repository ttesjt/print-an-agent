import type { ResolvedResponsibility, ResponsibilityRouter } from '@print-an-agent/base-actor';
import type { AgentId } from '@print-an-agent/base-identity';
import type { AgentTraceEmitter } from '@print-an-agent/base-observability';
import type {
  AssistantModelMessage,
  ContextModelMessage,
  ModelMessage,
  TextTokenInput,
  TokenCounter,
} from '@print-an-agent/model-invocation-core';
import type { SessionCompactionRejectionReason } from '../planning/contracts.js';
import type { CompactionMeasurementResources } from '../planning/measurement.js';
import type { WorkflowContext, WorkflowDefinition } from '@print-an-agent/workflow-core';
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

/** Compaction business input; Core supplies execution and cancellation separately. */
export interface SessionCompactionWorkflowInput {
  readonly agentId: AgentId;
  readonly compactionInput: CompactSessionInput;
  readonly traceEmitter?: AgentTraceEmitter;
}

export type SessionCompactionWorkflowContext = WorkflowContext<
  SessionCompactionStepName,
  SessionCompactionState,
  SessionCompactionResources
>;
export interface SessionCompactionState extends SessionCompactionWorkflowInput {
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
  outcome?: SessionCompactionOutcome;
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
  SessionCompactionWorkflowInput,
  SessionCompactionState,
  SessionCompactionResources,
  SessionCompactionOutcome | undefined
>;
export type SessionCompactionCondition = NonNullable<SessionCompactionDefinition['condition']>;
export type CreateSessionCompactionWorkflowOptions = Omit<
  SessionCompactionDefinition,
  'name' | 'entryStep' | 'stepDefinitions' | 'createState' | 'createResult' | 'createSkippedResult'
>;
