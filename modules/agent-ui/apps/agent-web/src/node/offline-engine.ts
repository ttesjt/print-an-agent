import { defineActorEngine } from '@ta-agent/model-invocation-core';
import { defineAssistantModelMessage } from '@ta-agent/model-invocation-core';

/** Explicit offline application profile; this is not a pretend remote provider. */
export function createOfflineWebEngine() {
  return defineActorEngine({
    id: 'agent-web.offline',
    capabilities: {
      invocationModes: ['interaction'],
      inputMediaTypes: ['text'],
      interaction: { streamable: true },
      toolCalling: false,
      structuredOutput: false,
      cancellation: true,
    },
    interact: async ({ prompt, signal, emit }) => {
      signal.throwIfAborted();
      await emit({ type: 'turn-start' });
      await emit({
        type: 'reasoning-delta',
        delta: 'This is an offline demonstration, not a model prediction.',
      });
      const text = `Offline reply: ${prompt.text}`;
      const message = defineAssistantModelMessage({
        role: 'assistant',
        text,
        timestamp: Date.now(),
        stopReason: 'stop',
        provenance: { kind: 'engine-defined', type: 'agent-web.offline', evidence: {} },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
        },
      });
      await emit({ type: 'text-delta', delta: text });
      await emit({ type: 'assistant-complete', message });
      await emit({ type: 'turn-end' });
      return { message };
    },
  });
}
