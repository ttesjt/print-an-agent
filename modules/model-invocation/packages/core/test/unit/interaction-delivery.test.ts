import { describe, expect, it } from 'vitest';
import { createActorInteractionProtocol } from '../../src/actor/engine-protocol.js';
import { assistantMessage } from '../support/fixtures.js';

describe('Actor interaction delivery ownership', () => {
  it('waits for unawaited delivery before publishing terminal and closing events', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const events: string[] = [];
    const protocol = createActorInteractionProtocol(async (event) => {
      events.push(event.type);
      if (event.type === 'text-delta') {
        started.resolve();
        await release.promise;
      }
    }, 1);
    const message = assistantMessage('answer');
    void protocol.emit({ type: 'text-delta', delta: 'answer' });
    void protocol.emit({ type: 'assistant-complete', message });
    void protocol.emit({ type: 'turn-end' });
    void protocol.emit({ type: 'interaction-end' });
    protocol.close();
    const result = protocol.complete({ message });
    await started.promise;
    expect(events).toEqual(['text-delta']);
    release.resolve();
    await expect(result).resolves.toEqual({ message });
    expect(events).toEqual(['text-delta', 'assistant-complete', 'turn-end', 'interaction-end']);
    await expect(protocol.emit({ type: 'text-delta', delta: 'late' })).rejects.toMatchObject({
      code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
    });
    expect(events).toHaveLength(4);
  });

  it('retains a downstream failure even when the Engine catches it and returns a valid result', async () => {
    const failure = new Error('downstream failure');
    const events: string[] = [];
    const protocol = createActorInteractionProtocol((event) => {
      events.push(event.type);
      return Promise.reject(failure);
    }, 1);
    await expect(protocol.emit({ type: 'text-delta', delta: 'answer' })).rejects.toBe(failure);
    const message = assistantMessage('answer');
    await expect(protocol.emit({ type: 'assistant-complete', message })).rejects.toBe(failure);
    await expect(protocol.complete({ message })).rejects.toBe(failure);
    expect(events).toEqual(['text-delta']);
  });

  it('fails if the Engine emits late while terminal publication is still in flight', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const events: string[] = [];
    const protocol = createActorInteractionProtocol(async (event) => {
      events.push(event.type);
      started.resolve();
      await release.promise;
    }, 1);
    const message = assistantMessage('answer');
    await protocol.emit({ type: 'assistant-complete', message });
    await protocol.emit({ type: 'interaction-end' });
    const completion = protocol.complete({ message });
    const checked = expect(completion).rejects.toMatchObject({
      code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
    });
    await started.promise;
    await expect(protocol.emit({ type: 'text-delta', delta: 'late' })).rejects.toMatchObject({
      code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
    });
    release.resolve();
    await checked;
    expect(events).toEqual(['assistant-complete']);
  });
});
