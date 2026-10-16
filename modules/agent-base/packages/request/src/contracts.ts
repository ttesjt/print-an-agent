import type {
  AssistantModelMessage,
  TextDeltaEvent,
  ReasoningDeltaEvent,
} from '@ta-agent/base-model';
import type { SessionBranchId, SessionId } from '@ta-agent/base-session';
import type { ToolRunInspection } from '@ta-agent/base-tool';
import type { ExecutionTimeoutMilliseconds } from '@ta-agent/workflow-core';
import type { RequestIdempotencyKey } from './replay/contracts.js';

export interface AgentRequestInput {
  readonly message: string;
  /** Existing Session identity. Omit to create; never a requested name for a new Session. */
  readonly sessionId?: string;
  readonly idempotencyKey?: string;
  readonly outputSink?: OutputSink;
}

export interface ValidatedAgentRequest {
  readonly message: string;
  readonly sessionId?: SessionId;
  readonly idempotencyKey?: RequestIdempotencyKey;
  readonly outputSink: OutputSink;
}

export interface AgentResponse {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly branchId: SessionBranchId;
  readonly message: AssistantModelMessage;
  readonly toolRun: ToolRunInspection;
}

export interface OutputOpenEvent {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly branchId: SessionBranchId;
}

export type OutputTextDeltaEvent = TextDeltaEvent;
export type OutputReasoningDeltaEvent = ReasoningDeltaEvent;
export type OutputStreamEvent = OutputTextDeltaEvent | OutputReasoningDeltaEvent;

export interface OutputFailure {
  readonly code: string;
  readonly message: string;
}

export interface OutputSink {
  open(event: OutputOpenEvent): Promise<void>;
  /** Function-valued contract keeps union acceptance contravariant for typed consumers. */
  readonly write: (event: OutputStreamEvent) => Promise<void>;
  close(response: AgentResponse): Promise<void>;
  fail(failure: OutputFailure): Promise<void>;
}

export interface InstructionContributorContext {
  readonly request: ValidatedAgentRequest;
}

export type InstructionContributor = (
  context: InstructionContributorContext
) => string | Promise<string>;

export interface RequestPolicy {
  readonly maxMessageCharacters: number;
  readonly maxInstructionsCharacters: number;
  readonly maxOutputCharacters: number;
  /** Readable reasoning characters across all model turns, including skipped delivery. */
  readonly maxReasoningCharacters: number;
  readonly maxModelTurns: number;
  /** Maximum accepted interaction events, including the event currently being delivered. */
  readonly maxPendingInteractionEvents: number;
  /** Cooperative Request Workflow execution deadline; null adds no local deadline. */
  readonly timeoutMilliseconds: ExecutionTimeoutMilliseconds;
}
