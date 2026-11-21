import type { Context, Message } from '@earendil-works/pi-ai';
import type { ActorInvocationConfig, ModelMessage } from '@print-an-agent/model-invocation-core';
import { toModelMessage } from '../translation/index.js';
import type { PiFauxRequestSnapshot, PiFauxToolResultSnapshot } from './types.js';

export function snapshotFromPiContext(
  context: Context,
  callIndex: number,
  kind: PiFauxRequestSnapshot['kind'],
  invocationConfig: ActorInvocationConfig
): PiFauxRequestSnapshot {
  return Object.freeze({
    kind,
    callIndex,
    instructions: context.systemPrompt ?? '',
    invocationConfig: Object.freeze({ ...invocationConfig }),
    messages: Object.freeze(
      context.messages.flatMap((message) => {
        const normalized = toModelMessage(message);
        return normalized === undefined ? [] : [normalized];
      })
    ),
    toolResults: Object.freeze(
      context.messages.flatMap((message) => {
        const normalized = toToolResultSnapshot(message);
        return normalized === undefined ? [] : [normalized];
      })
    ),
  });
}

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
