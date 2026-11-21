import {
  createActor,
  defineAssistantModelMessage,
  type ActorEngineInput,
  type ActorInteractionHandler,
  type AssistantModelMessage,
} from '@print-an-agent/model-invocation-core';
import type { SessionlessOutputSink } from '../../../src/index.js';

export function interactionActor(interact: ActorInteractionHandler) {
  return createActor({
    id: 'caller-owned',
    engine: {
      id: 'interaction-fixture',
      capabilities: {
        invocationModes: ['interaction'],
        interaction: { streamable: true },
        inputMediaTypes: ['text'],
        toolCalling: true,
        structuredOutput: false,
        cancellation: true,
      },
      interact,
    },
  });
}

export function assistant(text = 'answer'): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    timestamp: 1,
    stopReason: 'stop',
    provenance: { kind: 'engine-defined', type: 'fixture', evidence: {} },
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  });
}

export function generationActor(
  handlers: Pick<ActorEngineInput, 'complete' | 'stream'> = {
    complete: () => Promise.resolve({ message: assistant() }),
  }
) {
  return createActor({
    id: 'website',
    instructions: 'actor instructions',
    engine: {
      id: 'fixture',
      capabilities: {
        invocationModes: [
          ...(handlers.complete === undefined ? [] : ['direct' as const]),
          ...(handlers.stream === undefined ? [] : ['stream' as const]),
        ],
        inputMediaTypes: ['text'],
        toolCalling: false,
        structuredOutput: false,
        cancellation: true,
      },
      ...handlers,
    },
  });
}

export function outputChannel(events: unknown[]): SessionlessOutputSink {
  return {
    open: (event) => {
      events.push({ type: 'opened', ...event });
      return Promise.resolve();
    },
    write: (event) => {
      events.push(event);
      return Promise.resolve();
    },
    close: (result) => {
      events.push({ type: 'closed', result });
      return Promise.resolve();
    },
    fail: (failure) => {
      events.push({ type: 'failed', failure });
      return Promise.resolve();
    },
  };
}
