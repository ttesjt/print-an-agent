import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type AssistantMessage,
  type Message,
} from '@earendil-works/pi-ai';
import type { ModelMessage } from '@ta-agent/base-model';
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
    invocationConfig: Object.freeze({ ...snapshot.invocationConfig }),
    messages: Object.freeze(snapshot.messages.map(cloneModelMessage)),
    toolResults: Object.freeze(snapshot.toolResults.map((result) => Object.freeze({ ...result }))),
  });
}

export function createResponseMessage(response: PiFauxResponse): AssistantMessage {
  const reasoning = response.reasoning === undefined ? [] : [fauxThinking(response.reasoning)];
  if (response.status === 'failure') {
    return {
      ...fauxAssistantMessage([...reasoning, fauxText(response.partialText ?? '')]),
      stopReason: 'error',
      errorMessage: response.message,
    };
  }
  if (response.status === 'tool-call') {
    const toolCall =
      response.callId === undefined
        ? fauxToolCall(response.name, { ...response.arguments })
        : fauxToolCall(response.name, { ...response.arguments }, { id: response.callId });
    const content = [
      ...reasoning,
      ...(response.text === undefined ? [] : [fauxText(response.text)]),
      toolCall,
    ];
    return fauxAssistantMessage(content, { stopReason: 'toolUse' });
  }
  return fauxAssistantMessage([...reasoning, fauxText(response.text)], {
    stopReason: response.stopReason ?? 'stop',
  });
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
