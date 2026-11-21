import type { AssistantModelMessage } from '../messages/index.js';

export interface TextDeltaEvent {
  readonly type: 'text-delta';
  readonly delta: string;
}

/** Provider/Engine-exposed readable reasoning, never an opaque signature or encrypted payload. */
export interface ReasoningDeltaEvent {
  readonly type: 'reasoning-delta';
  readonly delta: string;
}

export interface AssistantCompleteEvent {
  readonly type: 'assistant-complete';
  readonly message: AssistantModelMessage;
}

export type ModelGenerationEvent = TextDeltaEvent | ReasoningDeltaEvent | AssistantCompleteEvent;

export type ModelGenerationEventSink = (event: ModelGenerationEvent) => Promise<void>;

export type ModelInteractionEvent =
  | ModelGenerationEvent
  | Readonly<{ type: 'interaction-start' }>
  | Readonly<{ type: 'turn-start' }>
  | Readonly<{ type: 'tool-call-start'; callId: string; toolName: string }>
  | Readonly<{
      type: 'tool-call-end';
      callId: string;
      toolName: string;
      status: 'success' | 'error';
      resultCharacters: number;
    }>
  | Readonly<{ type: 'turn-end' }>
  | Readonly<{ type: 'interaction-end' }>;

export type ModelInteractionEventSink = (event: ModelInteractionEvent) => Promise<void>;
