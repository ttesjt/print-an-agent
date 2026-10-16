import type {
  ActorEngineInput,
  ActorEngineInteractionRequest,
  ActorEngineDirectRequest,
} from '@ta-agent/model-invocation-core';
import {
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
  type AssistantModelMessage,
} from '@ta-agent/model-invocation-core';
import type { ToolRuntime } from '@ta-agent/base-tool';

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

export const EMPTY_TOOL_RUNTIME: ToolRuntime = Object.freeze({
  tools: Object.freeze([]),
  execute: () => Promise.resolve(Object.freeze({ status: 'success', text: '' })),
  close: () => undefined,
  inspect: () =>
    Object.freeze({
      status: 'open',
      effectiveTools: Object.freeze([]),
      records: Object.freeze([]),
      totalResultCharacters: 0,
    }),
});

export interface FakeEngineInspection {
  readonly interactionRequests: ActorEngineInteractionRequest[];
  readonly directRequests: ActorEngineDirectRequest[];
}

export function fakeEngine(
  id: string,
  inspection: FakeEngineInspection,
  options: Readonly<{ failInteraction?: boolean; tools?: boolean }> = {}
): ActorEngineInput {
  return {
    id,
    capabilities: {
      invocationModes: ['interaction', 'direct'],
      inputMediaTypes: ['text'],
      interaction: { streamable: true },
      toolCalling: options.tools ?? true,
      structuredOutput: false,
      cancellation: true,
      maxContextTokens: 8_192,
    },
    interact: async (request) => {
      inspection.interactionRequests.push(request);
      if (options.failInteraction === true) throw new Error('primary failed');
      const message = assistantMessage(`${id}:interaction`);
      await request.emit({ type: 'assistant-complete', message });
      return Object.freeze({ message });
    },
    complete: (request) => {
      inspection.directRequests.push(request);
      return Promise.resolve(Object.freeze({ message: assistantMessage(`${id}:direct`) }));
    },
  };
}
