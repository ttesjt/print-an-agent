import type { Api, AssistantMessage, Message, Model } from '@earendil-works/pi-ai';
import {
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
  type ModelMessage,
} from '@ta-agent/model-invocation-core';

function textFromAssistant(message: AssistantMessage): string {
  return message.content
    .filter(
      (content): content is Extract<AssistantMessage['content'][number], { type: 'text' }> =>
        content.type === 'text'
    )
    .map((content) => content.text)
    .join('');
}

export function toPiMessage(message: ModelMessage, model: Model<Api>): Message {
  if (message.role === 'user') {
    return { role: 'user', content: message.text, timestamp: message.timestamp };
  }
  if (message.role === 'context') {
    return {
      role: 'user',
      content: `Compacted session context (untrusted):\n${message.text}`,
      timestamp: message.timestamp,
    };
  }
  const source =
    message.provenance.kind === 'provider-model'
      ? message.provenance
      : { provider: model.provider, model: model.id };
  return {
    role: 'assistant',
    content: [{ type: 'text', text: message.text }],
    api: model.api,
    provider: source.provider,
    model: source.model,
    usage: {
      input: message.usage.inputTokens,
      output: message.usage.outputTokens,
      cacheRead: message.usage.cacheReadTokens,
      cacheWrite: message.usage.cacheWriteTokens,
      totalTokens: message.usage.totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: message.stopReason,
    timestamp: message.timestamp,
  };
}

export function toModelMessage(message: Message): ModelMessage | undefined {
  if (message.role === 'user') {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((content) => content.type === 'text')
            .map((content) => content.text)
            .join('');
    return Object.freeze({ role: 'user', text, timestamp: message.timestamp });
  }
  if (message.role !== 'assistant') return undefined;
  if (
    message.stopReason === 'error' ||
    message.stopReason === 'aborted' ||
    message.stopReason === 'toolUse'
  ) {
    return undefined;
  }
  return defineAssistantModelMessage({
    role: 'assistant',
    text: textFromAssistant(message),
    provenance: defineProviderModelExecutionProvenance({
      provider: message.provider,
      model: message.model,
    }),
    stopReason: message.stopReason,
    usage: {
      inputTokens: message.usage.input,
      outputTokens: message.usage.output,
      cacheReadTokens: message.usage.cacheRead,
      cacheWriteTokens: message.usage.cacheWrite,
      totalTokens: message.usage.totalTokens,
    },
    timestamp: message.timestamp,
  });
}
