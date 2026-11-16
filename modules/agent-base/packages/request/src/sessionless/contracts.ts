import type {
  ActorDirectRequest,
  ActorDirectResult,
  ModelMessage,
  ResolvedActor,
} from '@print-an-agent/model-invocation-core';
import type { WorkflowContext, WorkflowDefinition } from '@print-an-agent/workflow-core';
import type { OutputFailure, OutputStreamEvent } from '../contracts.js';
import type { RequestInteractionState } from '../interaction/state.js';

export interface SessionlessRequestInput {
  readonly message: string;
  readonly history?: readonly ModelMessage[];
}

/** A per-run channel, without Agent, Session or persistence authority. */
export interface SessionlessOutputSink {
  open(event: Readonly<{ workflowRunId: string }>): Promise<void>;
  readonly write: (event: OutputStreamEvent) => Promise<void>;
  close(result: ActorDirectResult): Promise<void>;
  fail(failure: OutputFailure): Promise<void>;
}

export interface SessionlessValidatedRequest extends SessionlessRequestInput {
  readonly history: readonly ModelMessage[];
  readonly outputSink?: SessionlessOutputSink;
}

/** Successful channel closure is irreversible, even if a later Run hook fails. */
export type SessionlessOutputOutcome = 'closed' | 'failure-attempted';

export interface SessionlessGenerationPolicy {
  readonly maxMessageCharacters: number;
  /** Text characters across history, external context and the current message; not a token count. */
  readonly maxContextCharacters: number;
  /** Includes the current user message; bounds structural overhead even for empty history text. */
  readonly maxContextMessages: number;
  readonly maxInstructionsCharacters: number;
  readonly maxOutputCharacters: number;
  readonly maxReasoningCharacters: number;
  readonly maxPendingInteractionEvents: number;
}

export interface SessionlessGenerationResources {
  readonly actor: ResolvedActor;
  readonly policy?: Partial<SessionlessGenerationPolicy>;
  readonly instructionContributors?: readonly ((context: {
    readonly request: SessionlessValidatedRequest;
  }) => string | Promise<string>)[];
  readonly createOutputSink?: (
    context: Readonly<{
      request: SessionlessRequestInput;
      workflowRunId: string;
      signal: AbortSignal;
    }>
  ) => SessionlessOutputSink | Promise<SessionlessOutputSink>;
  readonly clock?: () => number;
}

export interface BoundSessionlessGenerationResources extends Omit<
  SessionlessGenerationResources,
  'policy' | 'instructionContributors' | 'clock'
> {
  readonly policy: SessionlessGenerationPolicy;
  readonly instructionContributors: NonNullable<
    SessionlessGenerationResources['instructionContributors']
  >;
  readonly clock: () => number;
}

export interface SessionlessGenerationState {
  readonly input: SessionlessRequestInput;
  request?: SessionlessValidatedRequest;
  outputOutcome?: SessionlessOutputOutcome;
  actor?: ResolvedActor;
  instructions?: string;
  /** Optional context contributor output, kept separate from caller history. */
  externalContext?: readonly ModelMessage[];
  modelRequest?: ActorDirectRequest;
  interaction?: RequestInteractionState;
  response?: ActorDirectResult;
}

export const SESSIONLESS_REQUEST_STEP_NAMES = Object.freeze([
  'runRequest',
  'prepareRequest',
  'validateRequest',
  'resolveExecutionTarget',
  'resolveInstructions',
  'gatherExternalContext',
  'buildModelContext',
  'executeRequest',
  'openResponseStream',
  'invokeModel',
  'dispatchModelEvent',
  'deliverTextDelta',
  'deliverReasoningDelta',
  'buildResponse',
  'validateResponse',
  'completeResponse',
] as const);
export type SessionlessRequestStepName = (typeof SESSIONLESS_REQUEST_STEP_NAMES)[number];
export type SessionlessGenerationContext = WorkflowContext<
  SessionlessRequestStepName,
  SessionlessGenerationState,
  BoundSessionlessGenerationResources,
  ActorDirectResult | undefined
>;
export interface SessionlessGenerationWorkflowOptions extends Pick<
  WorkflowDefinition<
    SessionlessRequestStepName,
    SessionlessRequestInput,
    SessionlessGenerationState,
    BoundSessionlessGenerationResources,
    ActorDirectResult | undefined
  >,
  'stepOverrides' | 'lifecycle' | 'condition' | 'createRunId' | 'executeStep'
> {
  readonly mode: 'direct' | 'stream';
  readonly name?: string;
  readonly resources: SessionlessGenerationResources;
}
