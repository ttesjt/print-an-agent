import type { ConversationReasoningBlock } from '@print-an-agent/ui-contracts';

export const TEMPORARY_EVENT = Object.freeze({
  OPENED: 'opened',
  TEXT: 'text-delta',
  REASONING: 'reasoning-delta',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const);

export interface TemporaryHistoryPair {
  readonly user: string;
  readonly assistant: string;
}
export interface TemporaryConversationRequest {
  readonly interactionId: string;
  readonly agentId: string;
  readonly expectedConfigRevision: string;
  readonly message: string;
  readonly history: readonly TemporaryHistoryPair[];
}
export interface TemporaryAssistant {
  readonly text: string;
  readonly timestamp: string;
  readonly stopReason: 'stop' | 'length';
  readonly reasoningBlocks: readonly ConversationReasoningBlock[];
}
export interface TemporaryFailure {
  readonly code: string;
  readonly message: string;
}
interface Correlated {
  readonly interactionId: string;
}
export type TemporaryConversationEvent = Correlated &
  (
    | Readonly<{ type: typeof TEMPORARY_EVENT.OPENED }>
    | Readonly<{
        type: typeof TEMPORARY_EVENT.TEXT | typeof TEMPORARY_EVENT.REASONING;
        delta: string;
      }>
    | Readonly<{
        type: typeof TEMPORARY_EVENT.COMPLETED;
        assistant: TemporaryAssistant;
        configRevision: string;
      }>
    | Readonly<{ type: typeof TEMPORARY_EVENT.FAILED; failure: TemporaryFailure }>
    | Readonly<{ type: typeof TEMPORARY_EVENT.CANCELLED }>
  );
export type TemporaryEventConsumer = (event: TemporaryConversationEvent) => Promise<void>;
export interface TemporaryConversationPort {
  streamTemporaryConversation(
    request: TemporaryConversationRequest & Readonly<{ signal?: AbortSignal }>,
    consume: TemporaryEventConsumer
  ): Promise<void>;
}
