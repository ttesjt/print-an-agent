import {
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
  type AssistantModelMessage,
} from '../../src/index.js';

export function assistantMessage(text: string): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineProviderModelExecutionProvenance({
      provider: 'fake',
      model: 'fake-model',
    }),
    stopReason: 'stop',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    timestamp: 1,
  });
}
