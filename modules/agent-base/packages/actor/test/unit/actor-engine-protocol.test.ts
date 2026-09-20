import {
  createActorCatalog,
  MAIN_ACTOR_ID,
  type ActorDirectHandler,
  type ActorInteractionHandler,
} from '../../src/index.js';
import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
  defineProviderModelExecutionProvenance,
  type AgentLoopEvent,
  type AssistantModelMessage,
  type ModelExecutionEvidence,
  type ModelMessage,
} from '@ta-agent/base-model';
import { describe, expect, it } from 'vitest';
import { EMPTY_TOOL_RUNTIME } from '../support/fixtures.js';

function providerMessage(text: string, timestamp = 1): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineProviderModelExecutionProvenance({
      provider: 'provider',
      model: 'model',
    }),
    stopReason: 'stop',
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      totalTokens: 10,
    },
    timestamp,
  });
}

function engineMessage(text: string, evidence: ModelExecutionEvidence): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineEngineDefinedModelExecutionProvenance({
      type: 'test.runtime-target',
      evidence,
    }),
    stopReason: 'stop',
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      totalTokens: 10,
    },
    timestamp: 1,
  });
}

function invalidMessage(text: string): AssistantModelMessage {
  const valid = providerMessage(text);
  return {
    ...valid,
    timestamp: -1,
  };
}

async function resolveInteractionActor(interact: ActorInteractionHandler) {
  return createActorCatalog({
    actors: [{ id: MAIN_ACTOR_ID, engineId: 'engine' }],
    engines: [
      {
        id: 'engine',
        capabilities: {
          invocationModes: ['interaction'],
          inputMediaTypes: ['text'],
          interaction: { streamable: true },
          toolCalling: false,
          structuredOutput: false,
          cancellation: true,
        },
        interact,
      },
    ],
  }).resolve(MAIN_ACTOR_ID);
}

async function invokeInteraction(
  interact: ActorInteractionHandler,
  history: readonly ModelMessage[] = []
) {
  const actor = await resolveInteractionActor(interact);
  const events: AgentLoopEvent[] = [];
  const result = await actor.interact({
    instructions: '',
    history,
    prompt: { role: 'user', text: 'next', timestamp: 2 },
    tools: EMPTY_TOOL_RUNTIME,
    maxModelTurns: 1,
    maxOutputCharacters: 100,
    signal: new AbortController().signal,
    emit: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  });
  return { events, result };
}

function emitUnknown(
  emit: (event: AgentLoopEvent) => Promise<void>,
  event: unknown
): Promise<void> {
  const unchecked = emit as unknown as (input: unknown) => Promise<void>;
  return unchecked(event);
}

describe('Actor Engine protocol', () => {
  it('publishes one canonical terminal message after structural event/result parity', async () => {
    const emitted = engineMessage('complete', { alpha: 1, beta: { value: true } });
    const returned = engineMessage('complete', { beta: { value: true }, alpha: 1 });

    const { events, result } = await invokeInteraction(async (request) => {
      await request.emit({ type: 'interaction-start' });
      await request.emit({ type: 'assistant-complete', message: emitted });
      await request.emit({ type: 'turn-end' });
      await request.emit({ type: 'interaction-end' });
      return { message: returned };
    });

    expect(events.map((event) => event.type)).toEqual([
      'interaction-start',
      'assistant-complete',
      'turn-end',
      'interaction-end',
    ]);
    const terminal = events[1];
    expect(terminal?.type).toBe('assistant-complete');
    if (terminal?.type !== 'assistant-complete') throw new Error('Expected terminal event.');
    expect(result.message).toBe(terminal.message);
    expect(result.message.provenance).toMatchObject({
      kind: 'engine-defined',
      evidence: { alpha: 1, beta: { value: true } },
    });
  });

  it('enforces the model-turn budget for a custom Engine through a sticky failure', async () => {
    const message = providerMessage('complete');
    const actor = await resolveInteractionActor(async (request) => {
      await request.emit({ type: 'turn-start' });
      await request.emit({ type: 'turn-end' });
      try {
        await request.emit({ type: 'turn-start' });
      } catch {
        // The Engine cannot clear a model-turn budget failure and return successfully.
      }
      return { message };
    });
    const events: AgentLoopEvent[] = [];

    await expect(
      actor.interact({
        instructions: '',
        history: [],
        prompt: { role: 'user', text: 'next', timestamp: 2 },
        tools: EMPTY_TOOL_RUNTIME,
        maxModelTurns: 1,
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        emit: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      })
    ).rejects.toMatchObject({ code: 'MODEL_TURN_LIMIT_EXCEEDED' });
    expect(events.map((event) => event.type)).toEqual(['turn-start', 'turn-end']);
  });

  it('rejects a missing terminal event without publishing the returned message', async () => {
    const actor = await resolveInteractionActor(() =>
      Promise.resolve({ message: providerMessage('returned') })
    );
    const events: AgentLoopEvent[] = [];

    await expect(
      actor.interact({
        instructions: '',
        history: [],
        prompt: { role: 'user', text: 'next', timestamp: 2 },
        tools: EMPTY_TOOL_RUNTIME,
        maxModelTurns: 1,
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        emit: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      })
    ).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
    expect(events).toEqual([]);
  });

  it('keeps duplicate-terminal failure authoritative when the Engine catches emit rejection', async () => {
    const message = providerMessage('complete');
    const actor = await resolveInteractionActor(async (request) => {
      await request.emit({ type: 'assistant-complete', message });
      try {
        await request.emit({ type: 'assistant-complete', message });
      } catch {
        // A configured Engine cannot clear a protocol failure by catching its own emit rejection.
      }
      return { message };
    });
    const events: AgentLoopEvent[] = [];

    await expect(
      actor.interact({
        instructions: '',
        history: [],
        prompt: { role: 'user', text: 'next', timestamp: 2 },
        tools: EMPTY_TOOL_RUNTIME,
        maxModelTurns: 1,
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        emit: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      })
    ).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
    expect(events).toEqual([]);
  });

  it('rejects invalid emitted and returned terminal messages through one stable failure', async () => {
    const valid = providerMessage('valid');
    const cases: readonly ActorInteractionHandler[] = [
      async (request) => {
        await request.emit({
          type: 'assistant-complete',
          message: invalidMessage('invalid-event'),
        });
        return { message: valid };
      },
      async (request) => {
        await request.emit({ type: 'assistant-complete', message: valid });
        return { message: invalidMessage('invalid-result') };
      },
      async (request) => {
        await request.emit({ type: 'assistant-complete', message: valid });
        const resultWithUnsupportedState = { message: valid, internalState: 'must-not-cross' };
        return resultWithUnsupportedState;
      },
    ];

    for (const interact of cases) {
      await expect(invokeInteraction(interact)).rejects.toMatchObject({
        code: 'ACTOR_ENGINE_PROTOCOL_INVALID',
      });
    }
  });

  it('rejects event/result mismatch before publishing the terminal event', async () => {
    const actor = await resolveInteractionActor(async (request) => {
      await request.emit({ type: 'text-delta', delta: 'partial' });
      await request.emit({ type: 'assistant-complete', message: providerMessage('event') });
      await request.emit({ type: 'interaction-end' });
      return { message: providerMessage('result') };
    });
    const events: AgentLoopEvent[] = [];

    await expect(
      actor.interact({
        instructions: '',
        history: [],
        prompt: { role: 'user', text: 'next', timestamp: 2 },
        tools: EMPTY_TOOL_RUNTIME,
        maxModelTurns: 1,
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        emit: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      })
    ).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
    expect(events).toEqual([{ type: 'text-delta', delta: 'partial' }]);
  });

  it.each([
    {
      name: 'malformed reasoning event',
      emitInvalid: (emit: (event: AgentLoopEvent) => Promise<void>) =>
        emitUnknown(emit, { type: 'reasoning-delta', delta: null }),
    },
    {
      name: 'null event',
      emitInvalid: (emit: (event: AgentLoopEvent) => Promise<void>) => emitUnknown(emit, null),
    },
    {
      name: 'unknown event',
      emitInvalid: (emit: (event: AgentLoopEvent) => Promise<void>) =>
        emitUnknown(emit, { type: 'unknown-event' }),
    },
    {
      name: 'malformed event',
      emitInvalid: (emit: (event: AgentLoopEvent) => Promise<void>) =>
        emitUnknown(emit, { type: 'text-delta', delta: 1 }),
    },
  ])('rejects a $name through the stable protocol identity', async ({ emitInvalid }) => {
    const message = providerMessage('complete');
    await expect(
      invokeInteraction(async (request) => {
        await emitInvalid(request.emit);
        await request.emit({ type: 'assistant-complete', message });
        return { message };
      })
    ).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
  });

  it('rejects a successful return after interaction-end without a terminal message', async () => {
    const message = providerMessage('complete');
    await expect(
      invokeInteraction(async (request) => {
        await request.emit({ type: 'interaction-end' });
        return { message };
      })
    ).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
  });

  it('preserves Engine failure after a terminal-free interaction-end', async () => {
    const failure = new Error('provider failed');
    const actor = await resolveInteractionActor(async (request) => {
      await request.emit({ type: 'interaction-end' });
      throw failure;
    });
    const events: AgentLoopEvent[] = [];

    await expect(
      actor.interact({
        instructions: '',
        history: [],
        prompt: { role: 'user', text: 'next', timestamp: 2 },
        tools: EMPTY_TOOL_RUNTIME,
        maxModelTurns: 1,
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        emit: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      })
    ).rejects.toBe(failure);
    expect(events).toEqual([{ type: 'interaction-end' }]);
  });

  it('rejects every event after interaction-end even when the Engine replaces the failure', async () => {
    const replacementFailure = new Error('replacement failure');
    const actor = await resolveInteractionActor(async (request) => {
      await request.emit({ type: 'interaction-end' });
      try {
        await request.emit({ type: 'text-delta', delta: 'late' });
      } catch {
        throw replacementFailure;
      }
      return { message: providerMessage('unreachable') };
    });

    await expect(
      actor.interact({
        instructions: '',
        history: [],
        prompt: { role: 'user', text: 'next', timestamp: 2 },
        tools: EMPTY_TOOL_RUNTIME,
        maxModelTurns: 1,
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        emit: () => Promise.resolve(),
      })
    ).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
  });

  it.each([
    { type: 'text-delta', delta: 'late' } as const,
    { type: 'tool-call-start', callId: 'late-call', toolName: 'late-tool' } as const,
    { type: 'turn-start' } as const,
  ])('rejects $type after the terminal assistant message', async (lateEvent) => {
    const message = providerMessage('complete');
    await expect(
      invokeInteraction(async (request) => {
        await request.emit({ type: 'assistant-complete', message });
        await request.emit(lateEvent);
        return { message };
      })
    ).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
  });

  it('normalizes malformed direct results into the Actor protocol failure identity', async () => {
    const complete: ActorDirectHandler = () =>
      Promise.resolve({ message: invalidMessage('invalid-direct') });
    const actor = await createActorCatalog({
      actors: [{ id: MAIN_ACTOR_ID, engineId: 'engine' }],
      engines: [
        {
          id: 'engine',
          capabilities: {
            invocationModes: ['direct'],
            inputMediaTypes: ['text'],
            toolCalling: false,
            structuredOutput: false,
            cancellation: true,
          },
          complete,
        },
      ],
    }).resolve(MAIN_ACTOR_ID);

    await expect(
      actor.complete({
        instructions: '',
        messages: [],
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });
  });

  it('passes mixed historical provenance to the Engine without rewriting it', async () => {
    const history = Object.freeze([
      Object.freeze({ role: 'user' as const, text: 'first', timestamp: 1 }),
      providerMessage('provider answer', 2),
      Object.freeze({ role: 'user' as const, text: 'second', timestamp: 3 }),
      engineMessage('engine answer', { target: 'custom' }),
    ]);
    let observed: readonly ModelMessage[] | undefined;

    await invokeInteraction(async (request) => {
      observed = request.history;
      const message = providerMessage('next answer', 4);
      await request.emit({ type: 'assistant-complete', message });
      return { message };
    }, history);

    expect(observed).toEqual(history);
    expect(observed?.[1]).toMatchObject({
      role: 'assistant',
      provenance: { kind: 'provider-model', provider: 'provider', model: 'model' },
    });
    expect(observed?.[3]).toMatchObject({
      role: 'assistant',
      provenance: {
        kind: 'engine-defined',
        type: 'test.runtime-target',
        evidence: { target: 'custom' },
      },
    });
  });
});
