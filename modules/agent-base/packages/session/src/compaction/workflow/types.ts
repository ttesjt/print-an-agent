import type { ResolvedResponsibility, ResponsibilityRouter } from '@print-an-agent/base-actor';
import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import type { AgentTraceEmitter } from '@print-an-agent/base-observability';
import type {
  AssistantModelMessage,
  ContextModelMessage,
  ModelMessage,
  TextTokenInput,
  TokenCounter,
} from '@print-an-agent/model-invocation-core';
import type { WorkflowContext, WorkflowDefinition } from '@print-an-agent/workflow-core';
import type {
  SessionBranchId,
  SessionInspectionPort,
  SessionSnapshot,
} from '../../contracts/index.js';
import type { SessionExecutionLease } from '../../lifecycle/index.js';
import type { SessionCompactionAssessment } from '../types/assessment.js';
import type { CompactSessionInput } from '../types/input.js';
import type { SessionCompactionOutcome } from '../types/outcome.js';
import type { SessionCompactionPolicy } from '../types/policy.js';
import type { SessionCompactionPort } from '../types/ports.js';
import type { SessionCompaction } from '../types/projection.js';
import type { SessionCompactionSource } from '../types/source.js';
import type { CompactionMeasurementResources } from '../types/token-measurement.js';
import type { SessionCompactionStepName } from './names.js';

export interface SessionCompactionResources extends CompactionMeasurementResources {
  readonly session: SessionInspectionPort & SessionCompactionPort;
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

export type SessionCompactionWorkflowContext<
  R extends SessionCompactionResources = SessionCompactionResources,
> = WorkflowContext<SessionCompactionStepName, SessionCompactionState, R>;
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

export type SessionCompactionDefinition<
  R extends SessionCompactionResources = SessionCompactionResources,
> = WorkflowDefinition<
  SessionCompactionStepName,
  SessionCompactionWorkflowInput,
  SessionCompactionState,
  R,
  SessionCompactionOutcome | undefined
>;
export type SessionCompactionCondition<
  R extends SessionCompactionResources = SessionCompactionResources,
> = NonNullable<SessionCompactionDefinition<R>['condition']>;
export type CreateSessionCompactionWorkflowOptions<
  R extends SessionCompactionResources = SessionCompactionResources,
> = Omit<
  SessionCompactionDefinition<R>,
  'name' | 'entryStep' | 'stepDefinitions' | 'createState' | 'createResult' | 'createSkippedResult'
>;
