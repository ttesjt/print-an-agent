import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
  defineProviderModelExecutionProvenance,
  defineProviderModelReference,
  type AssistantModelMessage,
  type UserModelMessage,
} from '@print-an-agent/model-invocation-core';

export const model = defineProviderModelReference({ provider: 'faux', model: 'faux-model' });

export const usage = Object.freeze({
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 3,
});

export function userMessage(text: string, timestamp: number): UserModelMessage {
  return Object.freeze({ role: 'user', text, timestamp });
}

export function assistantMessage(text: string, timestamp: number): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineProviderModelExecutionProvenance(model),
    stopReason: 'stop',
    usage: { ...usage },
    timestamp,
  });
}

export function engineAssistantMessage(text: string, timestamp: number): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineEngineDefinedModelExecutionProvenance({
      type: 'test.runtime-target',
      evidence: {
        artifact: { id: 'artifact-1', revision: 3 },
        route: ['embedded', 'generation-7'],
      },
    }),
    stopReason: 'stop',
    usage: { ...usage },
    timestamp,
  });
}
