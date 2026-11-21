import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createActor,
  defineActorEngine,
  requireStreamingCapability,
} from '../../../../src/index.js';
import { assistantMessage } from '../../../support/model.js';
import {
  STREAM_CAPABILITIES,
  streamingActor,
  streamingRequest,
} from '../../../support/streaming.js';

afterEach(() => vi.useRealTimers());

function abortFailure(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error('Aborted', { cause: reason });
}

describe('streaming invocation lifecycle', () => {
  it('retains a budget failure when an Engine delays settlement past the Actor deadline', async () => {
    vi.useFakeTimers();
    const release = Promise.withResolvers<void>();
    const rejected = Promise.withResolvers<void>();
    const actor = streamingActor(
      async (request) => {
        try {
          await request.emit({ type: 'reasoning-delta', delta: 'too much' });
        } catch {
          rejected.resolve();
        }
        await release.promise;
        return { message: assistantMessage('answer') };
      },
      { timeoutMilliseconds: 25 }
    );
    const run = actor.stream({ ...streamingRequest(), maxReasoningCharacters: 1 });
    const expectation = expect(run).rejects.toMatchObject({
      code: 'MODEL_REASONING_LIMIT_EXCEEDED',
    });
    await rejected.promise;
    await vi.advanceTimersByTimeAsync(25);
    release.resolve();
    await expectation;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps concurrent invocations isolated and reuses the Actor after cancellation', async () => {
    const parent = new AbortController();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const actor = streamingActor(async (request) => {
      if (request.instructions === 'cancelled') {
        entered.resolve();
        await new Promise<void>((_, reject) =>
          request.signal.addEventListener('abort', () => reject(abortFailure(request.signal)), {
            once: true,
          })
        );
      }
      if (request.instructions === 'survivor') await release.promise;
      request.signal.throwIfAborted();
      const message = assistantMessage(request.instructions);
      await request.emit({ type: 'assistant-complete', message });
      return { message };
    });
    const failure = new Error('cancel one');
    const cancelled = actor.stream({
      ...streamingRequest(undefined, parent.signal),
      instructions: 'cancelled',
    });
    const expectation = expect(cancelled).rejects.toBe(failure);
    const survivor = actor.stream({ ...streamingRequest(), instructions: 'survivor' });
    await entered.promise;
    parent.abort(failure);
    await expectation;
    release.resolve();
    await expect(survivor).resolves.toMatchObject({ message: { text: 'survivor' } });
    await expect(
      actor.stream({ ...streamingRequest(), instructions: 'later' })
    ).resolves.toMatchObject({ message: { text: 'later' } });
  });

  it('validates budgets before invoking the Engine', async () => {
    const stream = vi.fn(() => Promise.resolve({ message: assistantMessage('unused') }));
    const actor = streamingActor(stream);
    await expect(
      actor.stream({ ...streamingRequest(), maxReasoningCharacters: 0 })
    ).rejects.toMatchObject({ code: 'MODEL_RUNTIME_PROTOCOL_INVALID' });
    expect(stream).not.toHaveBeenCalled();
  });
  it('requires a matching stream handler and respects capability narrowing', () => {
    expect(() => defineActorEngine({ id: 'invalid', capabilities: STREAM_CAPABILITIES })).toThrow(
      'streaming capability'
    );
    const actor = createActor({
      id: 'limited',
      capabilityLimits: { invocationModes: ['direct'] },
      engine: {
        id: 'both',
        capabilities: { ...STREAM_CAPABILITIES, invocationModes: ['direct', 'stream'] },
        complete: () => Promise.resolve({ message: assistantMessage('a') }),
        stream: () => Promise.resolve({ message: assistantMessage('a') }),
      },
    });
    expect(actor).not.toHaveProperty('stream');
    expect(() => requireStreamingCapability(actor)).toThrow('does not support streaming');
  });

  it('has no default deadline and no timer to dispose', async () => {
    vi.useFakeTimers();
    const release = Promise.withResolvers<void>();
    const actor = streamingActor(async (request) => {
      await release.promise;
      request.signal.throwIfAborted();
      const message = assistantMessage('answer');
      await request.emit({ type: 'assistant-complete', message });
      return { message };
    });
    const run = actor.stream(streamingRequest());
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(vi.getTimerCount()).toBe(0);
    release.resolve();
    await expect(run).resolves.toMatchObject({ message: { text: 'answer' } });
  });

  it.each(['parent', 'actor'] as const)('preserves %s cancellation ownership', async (source) => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const entered = Promise.withResolvers<AbortSignal>();
    const actor = streamingActor(
      (request) => {
        entered.resolve(request.signal);
        return new Promise((_, reject) => {
          request.signal.addEventListener('abort', () => reject(abortFailure(request.signal)), {
            once: true,
          });
        });
      },
      { timeoutMilliseconds: 25 }
    );
    const run = actor.stream(streamingRequest(undefined, parent.signal));
    const failure = new Error('caller cancelled');
    const expectation =
      source === 'parent'
        ? expect(run).rejects.toBe(failure)
        : expect(run).rejects.toMatchObject({ code: 'ACTOR_INVOCATION_TIMEOUT' });
    const signal = await entered.promise;
    if (source === 'parent') parent.abort(failure);
    else await vi.advanceTimersByTimeAsync(25);
    await expectation;
    expect(signal.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(source === 'parent');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drains an in-flight consumer before returning Engine failure', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<void>();
    const failure = new Error('Engine failed');
    const actor = streamingActor(async (request) => {
      void request.emit({ type: 'text-delta', delta: 'partial' });
      await entered.promise;
      failed.resolve();
      throw failure;
    });
    let settled = false;
    const run = actor.stream(
      streamingRequest(async () => {
        entered.resolve();
        await release.promise;
      })
    );
    const observed = run.catch(() => {
      settled = true;
    });
    await failed.promise;
    expect(settled).toBe(false);
    release.resolve();
    await expect(run).rejects.toBe(failure);
    await observed;
  });
});
