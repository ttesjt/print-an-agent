import {
  defineModelInteractionEvent,
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
} from '../../../../src/index.js';
import { describe, expect, it } from 'vitest';

function assistantMessage() {
  return defineAssistantModelMessage({
    role: 'assistant',
    text: 'complete',
    provenance: defineProviderModelExecutionProvenance({
      provider: 'provider',
      model: 'model',
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

describe('Model interaction event definition', () => {
  it('normalizes every event variant into an immutable closed value', () => {
    const events = [
      { type: 'interaction-start' },
      { type: 'turn-start' },
      { type: 'text-delta', delta: 'a' },
      { type: 'reasoning-delta', delta: 'reason' },
      { type: 'tool-call-start', callId: 'call-1', toolName: 'lookup' },
      {
        type: 'tool-call-end',
        callId: 'call-1',
        toolName: 'lookup',
        status: 'success',
        resultCharacters: 1,
      },
      { type: 'assistant-complete', message: assistantMessage() },
      { type: 'turn-end' },
      { type: 'interaction-end' },
    ];

    for (const event of events) {
      expect(Object.isFrozen(defineModelInteractionEvent(event))).toBe(true);
    }
  });

  it.each([
    null,
    {},
    { type: 'unknown-event' },
    { type: 'interaction-start', extra: true },
    { type: 'text-delta', delta: 1 },
    { type: 'reasoning-delta', delta: 1 },
    { type: 'reasoning-delta', delta: 'reason', signature: 'opaque' },
    {
      type: 'reasoning-delta',
      get delta() {
        throw new Error('must not access getter');
      },
    },
    {
      type: 'tool-call-end',
      callId: 'call-1',
      toolName: 'lookup',
      status: 'pending',
      resultCharacters: 1,
    },
    {
      type: 'tool-call-end',
      callId: 'call-1',
      toolName: 'lookup',
      status: 'success',
      resultCharacters: -1,
    },
  ])('rejects malformed or unsupported event %#', (event) => {
    let received: unknown;
    try {
      defineModelInteractionEvent(event);
    } catch (cause: unknown) {
      received = cause;
    }
    expect(received).toMatchObject({ code: 'MODEL_RUNTIME_PROTOCOL_INVALID' });
  });
});
