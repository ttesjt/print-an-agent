import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
} from '@earendil-works/pi-ai';
import { defineProviderModelReference, type ModelMessage } from '@ta-agent/base-model';
import type { PiFauxRequestSnapshot, PiFauxResponse, PiFauxToolResultSnapshot } from './types.js';

function cloneModelMessage(message: ModelMessage): ModelMessage {
  if (message.role === 'assistant') {
    return Object.freeze({ ...message, usage: Object.freeze({ ...message.usage }) });
  }
  return Object.freeze({ ...message });
}

export function cloneRequestSnapshot(snapshot: PiFauxRequestSnapshot): PiFauxRequestSnapshot {
  return Object.freeze({
    ...snapshot,
    messages: Object.freeze(snapshot.messages.map(cloneModelMessage)),
    toolResults: Object.freeze(snapshot.toolResults.map((result) => Object.freeze({ ...result }))),
  });
}

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
  return {
    role: 'assistant',
    content: [{ type: 'text', text: message.text }],
    api: model.api,
    provider: message.provider,
    model: message.model,
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
  const reference = defineProviderModelReference({
    provider: message.provider,
    model: message.model,
  });
  return Object.freeze({
    role: 'assistant',
    text: textFromAssistant(message),
    provider: reference.provider,
    model: reference.model,
    stopReason: message.stopReason,
    usage: Object.freeze({
      inputTokens: message.usage.input,
      outputTokens: message.usage.output,
      cacheReadTokens: message.usage.cacheRead,
      cacheWriteTokens: message.usage.cacheWrite,
      totalTokens: message.usage.totalTokens,
    }),
    timestamp: message.timestamp,
  });
}

export function createResponseMessage(response: PiFauxResponse): AssistantMessage {
  if (response.status === 'failure') {
    return {
      ...fauxAssistantMessage(response.partialText ?? ''),
      stopReason: 'error',
      errorMessage: response.message,
    };
  }
  if (response.status === 'tool-call') {
    const toolCall =
      response.callId === undefined
        ? fauxToolCall(response.name, { ...response.arguments })
        : fauxToolCall(response.name, { ...response.arguments }, { id: response.callId });
    const content = [...(response.text === undefined ? [] : [fauxText(response.text)]), toolCall];
    return fauxAssistantMessage(content, {
      stopReason: 'toolUse',
    });
  }
  return fauxAssistantMessage(response.text, { stopReason: response.stopReason ?? 'stop' });
}

export function toToolResultSnapshot(message: Message): PiFauxToolResultSnapshot | undefined {
  if (message.role !== 'toolResult') return undefined;
  return Object.freeze({
    callId: message.toolCallId,
    toolName: message.toolName,
    text: message.content
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join(''),
    isError: message.isError,
  });
}
