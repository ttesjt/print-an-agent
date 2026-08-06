import {
  AgentModelError,
  defineProviderModelReference,
  type AgentLoopEvent,
} from '@ta-agent/base-model';
import { describe, expect, it } from 'vitest';
import { createPiFauxRuntime } from '../../src/index.js';

function prompt(text: string) {
  return Object.freeze({ role: 'user' as const, text, timestamp: 1 });
}

describe('Pi faux Agent Loop runtime', () => {
  it('traverses the real Pi loop and normalizes ordered streaming events', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'hello' }],
      charactersPerChunk: 2,
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const events: AgentLoopEvent[] = [];

    const result = await profile.runtime.run({
      target,
      instructions: 'Be concise.',
      history: [],
      prompt: prompt('hi'),
      maxOutputCharacters: 100,
      signal: new AbortController().signal,
      emit: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });

    expect(result.message.text).toBe('hello');
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes.slice(0, 2)).toEqual(['interaction-start', 'turn-start']);
    expect(eventTypes.slice(-3)).toEqual(['assistant-complete', 'turn-end', 'interaction-end']);
    expect(eventTypes.slice(2, -3).every((type) => type === 'text-delta')).toBe(true);
    expect(eventTypes.filter((type) => type === 'text-delta').length).toBeGreaterThan(0);
    expect(
      events.flatMap((event) => (event.type === 'text-delta' ? [event.delta] : [])).join('')
    ).toBe('hello');
    expect(profile.inspect()).toMatchObject({ callCount: 1, pendingResponseCount: 0 });
    expect(profile.inspect().requests[0]).toMatchObject({
      instructions: 'Be concise.',
      messages: [{ role: 'user', text: 'hi' }],
    });
  });

  it('passes completed history and the new prompt through Pi', async () => {
    const profile = createPiFauxRuntime({
      responses: [
        (request) => ({
          status: 'success',
          text: request.messages.map((message) => `${message.role}:${message.text}`).join('|'),
        }),
      ],
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const priorAssistant = Object.freeze({
      role: 'assistant' as const,
      text: 'first answer',
      provider: profile.modelReference.provider,
      model: profile.modelReference.model,
      stopReason: 'stop' as const,
      usage: Object.freeze({
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 2,
      }),
      timestamp: 2,
    });

    const result = await profile.runtime.run({
      target,
      instructions: '',
      history: [prompt('first'), priorAssistant],
      prompt: Object.freeze({ role: 'user', text: 'second', timestamp: 3 }),
      maxOutputCharacters: 1_000,
      signal: new AbortController().signal,
      emit: () => Promise.resolve(),
    });

    expect(result.message.text).toBe('user:first|assistant:first answer|user:second');
  });

  it('maps a provider terminal error after partial output', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'failure', message: 'upstream failed', partialText: 'partial' }],
      charactersPerChunk: 3,
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const deltas: string[] = [];

    await expect(
      profile.runtime.run({
        target,
        instructions: '',
        history: [],
        prompt: prompt('hi'),
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        emit: (event) => {
          if (event.type === 'text-delta') deltas.push(event.delta);
          return Promise.resolve();
        },
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({ code: 'MODEL_PROVIDER_FAILED' })
    );
    expect(deltas.join('')).toBe('partial');
  });

  it('propagates cancellation during a paced stream', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'abcdefghij' }],
      charactersPerChunk: 1,
      tokensPerSecond: 1_000,
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);
    const controller = new AbortController();

    await expect(
      profile.runtime.run({
        target,
        instructions: '',
        history: [],
        prompt: prompt('hi'),
        maxOutputCharacters: 100,
        signal: controller.signal,
        emit: (event) => {
          if (event.type === 'text-delta') controller.abort();
          return Promise.resolve();
        },
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({
        code: 'MODEL_INVOCATION_CANCELLED',
      })
    );
  });

  it('aborts when normalized output crosses its bound', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'too long' }],
      charactersPerChunk: 2,
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);

    await expect(
      profile.runtime.run({
        target,
        instructions: '',
        history: [],
        prompt: prompt('hi'),
        maxOutputCharacters: 3,
        signal: new AbortController().signal,
        emit: () => Promise.resolve(),
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({
        code: 'MODEL_OUTPUT_LIMIT_EXCEEDED',
      })
    );
  });

  it('rejects an unregistered Provider Model Reference', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'success', text: 'unused' }],
    });

    await expect(
      profile.runtime.resolveTarget(
        defineProviderModelReference({ provider: 'missing', model: 'model' })
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({ code: 'MODEL_TARGET_NOT_FOUND' })
    );
  });

  it('fails closed when a model proposes a tool against the empty tool set', async () => {
    const profile = createPiFauxRuntime({
      responses: [{ status: 'tool-call', name: 'unexpected', arguments: { value: 1 } }],
    });
    const target = await profile.runtime.resolveTarget(profile.modelReference);

    await expect(
      profile.runtime.run({
        target,
        instructions: '',
        history: [],
        prompt: prompt('hi'),
        maxOutputCharacters: 100,
        signal: new AbortController().signal,
        emit: () => Promise.resolve(),
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentModelError>>({
        code: 'MODEL_RUNTIME_PROTOCOL_INVALID',
      })
    );
  });
});
