import { describe, expect, it } from 'vitest';
import type { ModelGenerationEvent, ActorStreamingRequest } from '../../src/index.js';
import { assistantMessage } from '../support/fixtures.js';
import { streamingActor, streamingRequest } from '../support/streaming.js';

describe('single-generation streaming protocol', () => {
  it('uses a stream-only Engine with readable reasoning and the same validated final result', async () => {
    const message = assistantMessage('answer');
    const events: ModelGenerationEvent[] = [];
    const actor = streamingActor(async (request) => {
      expect(request).not.toHaveProperty('tools');
      await request.emit({ type: 'reasoning-delta', delta: 'consider' });
      await request.emit({ type: 'text-delta', delta: 'answer' });
      await request.emit({ type: 'assistant-complete', message });
      return { message };
    });
    expect(actor).not.toHaveProperty('complete');
    expect(actor).not.toHaveProperty('interact');
    const result = await actor.stream(
      streamingRequest((event) => {
        events.push(event);
        return Promise.resolve();
      })
    );
    expect(events).toEqual([
      { type: 'reasoning-delta', delta: 'consider' },
      { type: 'text-delta', delta: 'answer' },
      { type: 'assistant-complete', message },
    ]);
    expect(result.message).toEqual(message);
    expect(Object.isFrozen(result.message)).toBe(true);
  });

  it.each([
    null,
    { type: 'unknown' },
    { type: 'turn-start' },
    { type: 'text-delta', delta: 1 },
    { type: 'text-delta', delta: 'a', extra: true },
  ])('rejects malformed or interaction event %j with a stable error', async (event) => {
    const actor = streamingActor(async (request) => {
      await request.emit(event as never);
      return { message: assistantMessage('unused') };
    });
    await expect(actor.stream(streamingRequest())).rejects.toMatchObject({
      code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
    });
  });

  it.each([
    'missing-terminal',
    'different-result',
    'different-deltas',
    'duplicate-terminal',
    'post-terminal-delta',
    'swallowed-error',
  ] as const)('fails closed for %s', async (scenario) => {
    const events: ModelGenerationEvent[] = [];
    const message = assistantMessage('answer');
    const actor = streamingActor(async (request) => {
      if (scenario === 'swallowed-error') {
        try {
          await request.emit({ type: 'unknown' } as never);
        } catch {
          /* Engine cannot clear protocol failure. */
        }
        return { message };
      }
      await request.emit({
        type: 'text-delta',
        delta: scenario === 'different-deltas' ? 'other' : 'answer',
      });
      if (scenario !== 'missing-terminal')
        await request.emit({ type: 'assistant-complete', message });
      if (scenario === 'duplicate-terminal')
        await request.emit({ type: 'assistant-complete', message });
      if (scenario === 'post-terminal-delta')
        await request.emit({ type: 'text-delta', delta: 'late' });
      return { message: scenario === 'different-result' ? assistantMessage('different') : message };
    });
    await expect(
      actor.stream(
        streamingRequest((event) => {
          events.push(event);
          return Promise.resolve();
        })
      )
    ).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
    expect(events.some((event) => event.type === 'assistant-complete')).toBe(false);
  });

  it.each(['text-delta', 'reasoning-delta'] as const)(
    'enforces the %s budget before forwarding over-budget content',
    async (type) => {
      const actor = streamingActor(async (request) => {
        await request.emit({ type, delta: 'oversized' });
        return { message: assistantMessage('unreachable') };
      });
      const events: ModelGenerationEvent[] = [];
      await expect(
        actor.stream({
          ...streamingRequest((event) => {
            events.push(event);
            return Promise.resolve();
          }),
          maxOutputCharacters: 2,
          maxReasoningCharacters: 2,
        })
      ).rejects.toMatchObject({
        code:
          type === 'text-delta' ? 'MODEL_OUTPUT_LIMIT_EXCEEDED' : 'MODEL_REASONING_LIMIT_EXCEEDED',
      });
      expect(events).toEqual([]);
    }
  );

  it('serializes and drains unawaited deltas with backpressure before terminal publication', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const seen: string[] = [];
    const message = assistantMessage('ab');
    const actor = streamingActor((request) => {
      void request.emit({ type: 'text-delta', delta: 'a' });
      void request.emit({ type: 'text-delta', delta: 'b' });
      void request.emit({ type: 'assistant-complete', message });
      return Promise.resolve({ message });
    });
    const run = actor.stream(
      streamingRequest(async (event) => {
        seen.push(event.type === 'text-delta' ? event.delta : event.type);
        if (seen.length === 1) {
          entered.resolve();
          await release.promise;
        }
      })
    );
    await entered.promise;
    expect(seen).toEqual(['a']);
    release.resolve();
    await run;
    expect(seen).toEqual(['a', 'b', 'assistant-complete']);
  });

  it('preserves downstream failure and rejects emission after settlement', async () => {
    const failure = new Error('sink failed');
    let saved: ActorStreamingRequest['emit'] | undefined;
    const actor = streamingActor(async (request) => {
      saved = request.emit;
      await request.emit({ type: 'text-delta', delta: 'a' });
      return { message: assistantMessage('a') };
    });
    await expect(actor.stream(streamingRequest(() => Promise.reject(failure)))).rejects.toBe(
      failure
    );
    if (saved === undefined) throw new Error('Missing emitter');
    await expect(saved({ type: 'text-delta', delta: 'late' })).rejects.toMatchObject({
      code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
    });
  });
});
