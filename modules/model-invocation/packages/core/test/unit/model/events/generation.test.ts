import { expect, it } from 'vitest';
import { defineModelGenerationEvent, defineModelInteractionEvent } from '../../../../src/index.js';
import { assistantMessage } from '../../../support/model.js';

it.each([
  { type: 'text-delta', delta: 'text' },
  { type: 'reasoning-delta', delta: '' },
  { type: 'assistant-complete', message: assistantMessage('answer') },
])('normalizes the common $type protocol identically for generation and interaction', (input) => {
  const generation = defineModelGenerationEvent(input);
  expect(generation).toEqual(defineModelInteractionEvent(input));
  expect(Object.isFrozen(generation)).toBe(true);
});

it.each([
  { type: 'interaction-start' },
  { type: 'turn-end' },
  { type: 'tool-call-start', callId: 'call', toolName: 'tool' },
])('keeps $type exclusive to interaction', (input) => {
  expect(() => defineModelInteractionEvent(input)).not.toThrow();
  expect(() => defineModelGenerationEvent(input)).toThrowError(/Generation cannot emit/);
});

it('preserves message validation errors and never evaluates event field accessors', () => {
  for (const normalize of [defineModelGenerationEvent, defineModelInteractionEvent]) {
    let failure: unknown;
    try {
      normalize({ type: 'assistant-complete', message: { role: 'assistant' } });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'MODEL_MESSAGE_INVALID' });
    let reads = 0;
    expect(() =>
      normalize({
        type: 'text-delta',
        get delta() {
          reads += 1;
          return 'private';
        },
      })
    ).toThrowError(/data property/);
    expect(reads).toBe(0);
  }
});
