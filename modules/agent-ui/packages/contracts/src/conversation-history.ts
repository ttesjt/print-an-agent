import type {
  ConversationPage,
  ConversationPageCursor,
  ConversationResult,
} from './conversation-types.js';

export interface ReadConversationInput {
  readonly agentId: string;
  readonly branchId: string;
  readonly cursor?: ConversationPageCursor;
  readonly limit?: number;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export interface ConversationHistoryPort {
  readConversation(input: ReadConversationInput): Promise<ConversationResult<ConversationPage>>;
}
