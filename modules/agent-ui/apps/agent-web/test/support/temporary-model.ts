import {
  defineActorEngine,
  defineAssistantModelMessage,
  type ActorStreamingHandler,
} from '@print-an-agent/model-invocation-core';

export function temporaryMessage(text = 'answer') {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    timestamp: 1,
    stopReason: 'stop',
    provenance: {
      kind: 'engine-defined',
      type: 'temporary.fixture',
      evidence: { private: 'do-not-project' },
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  });
}
export function temporaryEngine(
  stream: ActorStreamingHandler = async (request) => {
    await request.emit({ type: 'reasoning-delta', delta: 'consider' });
    await request.emit({ type: 'text-delta', delta: 'answer' });
    await request.emit({ type: 'assistant-complete', message: temporaryMessage() });
    return { message: temporaryMessage() };
  }
) {
  return defineActorEngine({
    id: 'temporary.fixture',
    capabilities: {
      invocationModes: ['stream'],
      inputMediaTypes: ['text'],
      toolCalling: false,
      structuredOutput: false,
      cancellation: true,
    },
    stream,
  });
}
