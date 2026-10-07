export type ConversationPageCursor = string;

export interface ConversationUserMessage {
  readonly text: string;
  readonly timestamp: string;
}

export interface ConversationReasoningBlock {
  /** One-based model invocation ordinal within this conversation turn. */
  readonly modelTurnIndex: number;
  readonly text: string;
}

export type ConversationToolActivityStatus = 'error' | 'pending' | 'success';

/**
 * Application-projected display data. Adapters must remove secrets and provider payloads before
 * constructing this value.
 */
export interface ConversationToolDetail {
  readonly label: string;
  readonly value: string;
}

export interface ConversationToolActivity {
  readonly callId: string;
  readonly details: readonly ConversationToolDetail[];
  readonly modelTurnIndex: number;
  readonly status: ConversationToolActivityStatus;
  readonly summary?: string;
  /** Adapter-projected, safe display label. This is not a raw tool implementation name. */
  readonly toolLabel: string;
}

export interface ConversationAssistantMessage {
  readonly reasoningBlocks: readonly ConversationReasoningBlock[];
  readonly text: string;
  readonly timestamp: string;
  readonly toolActivities: readonly ConversationToolActivity[];
}

interface ConversationTurnBase {
  readonly branchId: string;
  readonly turnId: string;
  readonly userMessage: ConversationUserMessage;
}

export interface CompletedConversationTurn extends ConversationTurnBase {
  readonly assistantMessage: ConversationAssistantMessage;
  readonly status: 'completed';
}

export interface FailedConversationTurn extends ConversationTurnBase {
  readonly failure: ConversationFailure;
  readonly status: 'failed';
}

export type ConversationTurn = CompletedConversationTurn | FailedConversationTurn;

export interface ConversationPage {
  /** Turns are chronological within a page. Older pages are prepended by consumers. */
  readonly nextCursor?: ConversationPageCursor;
  readonly turns: readonly ConversationTurn[];
}

export type ConversationFailureCode =
  | 'interaction-failed'
  | 'invalid-stream'
  | 'not-found'
  | 'operation-failed'
  | 'session-busy'
  | 'unavailable';

export interface ConversationFailure {
  readonly code: ConversationFailureCode;
  readonly message: string;
}

export type ConversationResult<Value> =
  | Readonly<{ readonly failure: ConversationFailure; readonly status: 'failed' }>
  | Readonly<{ readonly status: 'succeeded'; readonly value: Value }>;
