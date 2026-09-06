import type { AssistantModelMessage } from '@ta-agent/base-model';
import type { SessionBranchId, SessionId } from '@ta-agent/base-session';
import type { ToolRunInspection } from '@ta-agent/base-tool';
import type { RequestIdempotencyKey } from './replay/contracts.js';

export interface AgentRequestInput {
  readonly message: string;
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

export interface OutputTextDeltaEvent {
  readonly type: 'text-delta';
  readonly delta: string;
}

export interface OutputFailure {
  readonly code: string;
  readonly message: string;
}

export interface OutputSink {
  open(event: OutputOpenEvent): Promise<void>;
  write(event: OutputTextDeltaEvent): Promise<void>;
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
  readonly maxModelTurns: number;
  readonly timeoutMilliseconds: number;
}
