import { requireCompletionCapability } from '../../src/index.js';
import { requireInteractionCapability } from '../../src/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createActorCatalog,
  parseActorId,
  type ActorEngineInput,
  type ResolvedActor,
} from '../../src/index.js';
import { assistantMessage, EMPTY_TOOL_RUNTIME } from '../support/fixtures.js';
import type { InteractionTools } from '../../src/index.js';

const CAPABILITIES = Object.freeze({
  invocationModes: ['interaction', 'direct'] as const,
  inputMediaTypes: ['text'] as const,
  interaction: { streamable: true },
  toolCalling: false,
  structuredOutput: false,
  cancellation: true,
});

function resolveTestActor(
  engine: ActorEngineInput,
  timeoutMilliseconds: number | null | undefined
): Promise<ResolvedActor> {
  const catalog = createActorCatalog({
    actors: [
      {
        id: 'main',
        engineId: engine.id,
        ...(timeoutMilliseconds === undefined ? {} : { invocationPolicy: { timeoutMilliseconds } }),
      },
    ],
    engines: [engine],
  });
  return catalog.resolve(parseActorId('main'));
}

function directRequest(signal: AbortSignal) {
  return {
    instructions: '',
    messages: [],
    maxOutputCharacters: 100,
    signal,
  };
}

function interactionRequest(signal: AbortSignal) {
  return {
    instructions: '',
    history: [],
    prompt: { role: 'user' as const, text: 'hello', timestamp: 1 },
    tools: EMPTY_TOOL_RUNTIME,
    maxModelTurns: 1,
    maxOutputCharacters: 100,
    signal,
    emit: () => Promise.resolve(),
  };
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortFailure(signal));
      return;
    }
    signal.addEventListener('abort', () => reject(abortFailure(signal)), { once: true });
  });
}

function abortFailure(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Actor invocation was aborted.', { cause: signal.reason });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Actor invocation timeout', () => {
  it.each(['actor', 'parent', 'engine'] as const)(
    'propagates %s cancellation to tools even with a different runtime owner',
    async (source) => {
      vi.useFakeTimers();
      const parent = new AbortController();
      const engineLocal = new AbortController();
      const invoked = Promise.withResolvers<AbortSignal>();
      const closeTools = vi.fn();
      const tools: InteractionTools & { close(): void } = {
        ...EMPTY_TOOL_RUNTIME,
        execute: (_proposal, options) => {
          if (options?.signal === undefined) throw new Error('Missing invocation signal');
          invoked.resolve(options.signal);
          return rejectWhenAborted(options.signal);
        },
        close: closeTools,
      };
      const actor = await resolveTestActor(
        {
          id: 'engine',
          capabilities: CAPABILITIES,
          interact: async (request) => {
            await request.tools.execute(
              { callId: 'call', toolName: 'work', arguments: {} },
              source === 'actor' ? undefined : { signal: engineLocal.signal }
            );
            return { message: assistantMessage('unreachable') };
          },
          complete: () => Promise.resolve({ message: assistantMessage('unused') }),
        },
        25
      );
      const run = requireInteractionCapability(actor).interact({
        ...interactionRequest(parent.signal),
        tools,
      });
      const failure = new Error('local cancellation');
      const expectation =
        source === 'actor'
          ? expect(run).rejects.toMatchObject({ code: 'ACTOR_INVOCATION_TIMEOUT' })
          : expect(run).rejects.toBe(failure);
      const toolSignal = await invoked.promise;
      if (source === 'actor') await vi.advanceTimersByTimeAsync(25);
      else (source === 'parent' ? parent : engineLocal).abort(failure);
      await expectation;
      expect(toolSignal.aborted).toBe(true);
      expect(parent.signal.aborted).toBe(source === 'parent');
      expect(engineLocal.signal.aborted).toBe(source === 'engine');
      expect(closeTools).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );
  it('uses no timer and passes through the exact parent signal by default', async () => {
    vi.useFakeTimers();
    const parentSignal = new AbortController().signal;
    let receivedSignal: AbortSignal | undefined;
    const actor = await resolveTestActor(
      {
        id: 'engine',
        capabilities: CAPABILITIES,
        interact: () => Promise.resolve({ message: assistantMessage('unused') }),
        complete: (request) => {
          receivedSignal = request.signal;
          return Promise.resolve({ message: assistantMessage('done') });
        },
      },
      undefined
    );

    await expect(
      requireCompletionCapability(actor).complete(directRequest(parentSignal))
    ).resolves.toMatchObject({
      message: { text: 'done' },
    });
    expect(receivedSignal).toBe(parentSignal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['interact', 'complete'] as const)(
    'enforces an owned deadline for %s without aborting the parent',
    async (invocationKind) => {
      vi.useFakeTimers();
      const parentController = new AbortController();
      let receivedSignal: AbortSignal | undefined;
      const actor = await resolveTestActor(
        {
          id: 'engine',
          capabilities: CAPABILITIES,
          interact: (request) => {
            receivedSignal = request.signal;
            return rejectWhenAborted(request.signal);
          },
          complete: (request) => {
            receivedSignal = request.signal;
            return rejectWhenAborted(request.signal);
          },
        },
        25
      );

      const invocation =
        invocationKind === 'interact'
          ? requireInteractionCapability(actor).interact(
              interactionRequest(parentController.signal)
            )
          : requireCompletionCapability(actor).complete(directRequest(parentController.signal));
      const expectation = expect(invocation).rejects.toMatchObject({
        code: 'ACTOR_INVOCATION_TIMEOUT',
      });
      await vi.advanceTimersByTimeAsync(25);

      await expectation;
      expect(receivedSignal).not.toBe(parentController.signal);
      expect(receivedSignal?.aborted).toBe(true);
      expect(receivedSignal?.reason).toMatchObject({ name: 'TimeoutError' });
      expect(parentController.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('does not relabel parent cancellation as an Actor timeout', async () => {
    vi.useFakeTimers();
    const parentController = new AbortController();
    const cancellation = new Error('caller cancelled');
    const actor = await resolveTestActor(
      {
        id: 'engine',
        capabilities: CAPABILITIES,
        interact: () => Promise.resolve({ message: assistantMessage('unused') }),
        complete: (request) => rejectWhenAborted(request.signal),
      },
      1_000
    );

    const invocation = requireCompletionCapability(actor).complete(
      directRequest(parentController.signal)
    );
    const expectation = expect(invocation).rejects.toBe(cancellation);
    parentController.abort(cancellation);

    await expectation;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves an Engine failure that settles before the local deadline', async () => {
    vi.useFakeTimers();
    const failure = new Error('engine failed');
    const actor = await resolveTestActor(
      {
        id: 'engine',
        capabilities: CAPABILITIES,
        interact: () => Promise.resolve({ message: assistantMessage('unused') }),
        complete: () => Promise.reject(failure),
      },
      1_000
    );

    await expect(
      requireCompletionCapability(actor).complete(directRequest(new AbortController().signal))
    ).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports timeout after an uncooperative Engine eventually settles', async () => {
    vi.useFakeTimers();
    const deferred = Promise.withResolvers<{ message: ReturnType<typeof assistantMessage> }>();
    const actor = await resolveTestActor(
      {
        id: 'engine',
        capabilities: CAPABILITIES,
        interact: () => Promise.resolve({ message: assistantMessage('unused') }),
        complete: () => deferred.promise,
      },
      10
    );

    const invocation = requireCompletionCapability(actor).complete(
      directRequest(new AbortController().signal)
    );
    const expectation = expect(invocation).rejects.toMatchObject({
      code: 'ACTOR_INVOCATION_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(10);
    deferred.resolve({ message: assistantMessage('late') });

    await expectation;
  });

  it('does not deliver events produced after an uncooperative interaction exceeds its deadline', async () => {
    vi.useFakeTimers();
    const releaseEngine = Promise.withResolvers<void>();
    const delivered: string[] = [];
    const actor = await resolveTestActor(
      {
        id: 'engine',
        capabilities: CAPABILITIES,
        interact: async (request) => {
          await releaseEngine.promise;
          await request.emit({ type: 'text-delta', delta: 'late' });
          const message = assistantMessage('late');
          await request.emit({ type: 'assistant-complete', message });
          return { message };
        },
        complete: () => Promise.resolve({ message: assistantMessage('unused') }),
      },
      10
    );

    const invocation = requireInteractionCapability(actor).interact({
      ...interactionRequest(new AbortController().signal),
      emit: (event) => {
        delivered.push(event.type);
        return Promise.resolve();
      },
    });
    const expectation = expect(invocation).rejects.toMatchObject({
      code: 'ACTOR_INVOCATION_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(10);
    releaseEngine.resolve();

    await expectation;
    expect(delivered).toEqual([]);
  });

  it('preserves an authoritative Engine protocol failure over a concurrent timeout', async () => {
    vi.useFakeTimers();
    const actor = await resolveTestActor(
      {
        id: 'engine',
        capabilities: CAPABILITIES,
        interact: async (request) => {
          try {
            await rejectWhenAborted(request.signal);
          } catch {
            await request.emit({ type: 'unknown-event' } as never);
          }
          return { message: assistantMessage('unreachable') };
        },
        complete: () => Promise.resolve({ message: assistantMessage('unused') }),
      },
      10
    );

    const invocation = requireInteractionCapability(actor).interact(
      interactionRequest(new AbortController().signal)
    );
    const expectation = expect(invocation).rejects.toMatchObject({
      code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
    });
    await vi.advanceTimersByTimeAsync(10);

    await expectation;
  });
});
