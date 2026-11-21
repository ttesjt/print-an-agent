import type { ModelExecutionProvenance } from '../provenance/index.js';

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
}

export interface UserModelMessage {
  readonly role: 'user';
  readonly text: string;
  readonly timestamp: number;
}

export interface AssistantModelMessage {
  readonly role: 'assistant';
  readonly text: string;
  readonly provenance: ModelExecutionProvenance;
  readonly stopReason: 'stop' | 'length';
  readonly usage: ModelUsage;
  readonly timestamp: number;
}

export interface ContextModelMessage {
  readonly role: 'context';
  readonly text: string;
  readonly timestamp: number;
}

export type ModelMessage = UserModelMessage | AssistantModelMessage | ContextModelMessage;
