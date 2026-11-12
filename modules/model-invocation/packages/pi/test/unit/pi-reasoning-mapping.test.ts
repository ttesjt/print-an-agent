import {
  fauxAssistantMessage,
  fauxThinking,
  type AssistantMessageEvent,
} from '@earendil-works/pi-ai';
import type {
  ModelInteractionEvent,
  ModelInteractionRequest,
} from '@print-an-agent/model-invocation-core';
import { describe, expect, it } from 'vitest';
import { createPiFauxRuntime } from '../../src/index.js';
import { createPiEventSink, type PiRunState } from '../../src/runtime/pi-event-adapter.js';

describe('Pi readable reasoning mapping', () => {
  it('forwards only readable deltas, never signatures, redacted blocks, empty deltas, or end snapshots', async () => {
    const profile = createPiFauxRuntime({ responses: [{ status: 'success', text: 'unused' }] });
    const signal = new AbortController().signal;
    const events: ModelInteractionEvent[] = [];
    const request: ModelInteractionRequest = {
      target: await profile.runtime.resolveTarget(profile.modelReference),
      instructions: '',
      history: [],
      prompt: { role: 'user', text: 'hello', timestamp: 1 },
      tools: { tools: [], execute: () => Promise.reject(new Error('Unexpected tool call.')) },
      signal,
      maxModelTurns: 1,
      maxOutputCharacters: 100,
      emit: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
    const state: PiRunState = {
      outputCharacters: 0,
      modelTurns: 0,
      turnTextDeltas: [],
      toolAdapter: { attemptedCallIds: new Set() },
    };
    const sink = createPiEventSink(request, new AbortController(), state);
    const partial = fauxAssistantMessage([
      { ...fauxThinking('summary'), thinkingSignature: 'PRIVATE_SIGNATURE' },
      {
        ...fauxThinking('PRIVATE_REDACTED'),
        redacted: true,
        thinkingSignature: 'PRIVATE_CIPHERTEXT',
      },
    ]);
    const updates: AssistantMessageEvent[] = [
      { type: 'thinking_start', contentIndex: 0, partial },
      { type: 'thinking_delta', contentIndex: 0, delta: 'summary', partial },
      { type: 'thinking_delta', contentIndex: 0, delta: '', partial },
      { type: 'thinking_end', contentIndex: 0, content: 'summary', partial },
      { type: 'thinking_delta', contentIndex: 1, delta: 'PRIVATE_REDACTED', partial },
      { type: 'thinking_end', contentIndex: 1, content: 'PRIVATE_CIPHERTEXT', partial },
    ];
    for (const assistantMessageEvent of updates)
      await sink({ type: 'message_update', message: partial, assistantMessageEvent });
    expect(events).toEqual([{ type: 'reasoning-delta', delta: 'summary' }]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
    expect(state.outputCharacters).toBe(0);
    expect(state.turnTextDeltas).toEqual([]);
  });
});
