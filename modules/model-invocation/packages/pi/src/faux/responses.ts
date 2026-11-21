import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import type { PiFauxResponse } from './types.js';

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
