import { expect, it } from 'vitest';
import {
  createActor,
  requireStreamingCapability,
  requireCompletionCapability,
  type ModelGenerationEvent,
  type ProviderTransportLivenessPolicyInput,
} from '@print-an-agent/model-invocation-core';
import { createPiProviderRuntime, createPiFauxRuntime } from '../../../src/index.js';
import { completionServer } from '../../support/completion-server.js';

function providerActor(
  baseUrl: string,
  transportLivenessPolicy?: ProviderTransportLivenessPolicyInput
) {
  const profile = createPiProviderRuntime({
    provider: {
      kind: 'openai-compatible',
      reference: { provider: 'fixture', model: 'fixture', baseUrl },
      contextWindowTokens: 4096,
      maxOutputTokens: 256,
      supportsReasoning: true,
      compatibility: { supportsDeveloperRole: false },
    },
    ...(transportLivenessPolicy === undefined ? {} : { transportLivenessPolicy }),
  });
  return requireStreamingCapability(createActor({ id: 'generator', engine: profile.actorEngine }));
}

function request(
  emit: (event: ModelGenerationEvent) => Promise<void>,
  signal = new AbortController().signal
) {
  return {
    instructions: 'Generate.',
    messages: [{ role: 'user' as const, text: 'A fact.', timestamp: 1 }],
    maxOutputCharacters: 100,
    maxReasoningCharacters: 100,
    signal,
    emit,
  };
}

it('offers the same streaming capability through the deterministic Pi profile with truthful inspection', async () => {
  const profile = createPiFauxRuntime({ responses: [{ status: 'success', text: 'answer' }] });
  const actor = requireStreamingCapability(
    createActor({ id: 'faux', engine: profile.actorEngine })
  );
  await expect(actor.stream(request(() => Promise.resolve()))).resolves.toMatchObject({
    message: { text: 'answer' },
  });
  expect(profile.inspect()).toMatchObject({ callCount: 1, requests: [{ kind: 'stream' }] });
});

it('streams readable reasoning and text through one real Pi generation with the same Completion result', async () => {
  const server = await completionServer();
  try {
    const actor = providerActor(server.baseUrl);
    const events: ModelGenerationEvent[] = [];
    const streamed = await actor.stream(
      request((event) => {
        events.push(event);
        return Promise.resolve();
      })
    );
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).not.toHaveProperty('tools');
    expect(
      events
        .filter((event) => event.type === 'reasoning-delta')
        .map((event) => event.delta)
        .join('')
    ).toBe('consider the fact');
    expect(
      events
        .filter((event) => event.type === 'text-delta')
        .map((event) => event.delta)
        .join('')
    ).toBe('proposed update');
    expect(events.at(-1)).toEqual({ type: 'assistant-complete', message: streamed.message });
    expect(events.filter((event) => event.type === 'assistant-complete')).toHaveLength(1);
    const completed = await requireCompletionCapability(actor).complete(
      request(() => Promise.reject(new Error('Completion must not emit.')))
    );
    expect(completed.message.text).toBe(streamed.message.text);
    expect(completed.message.provenance).toEqual(streamed.message.provenance);
    expect(server.requests).toHaveLength(2);
  } finally {
    await server.close();
  }
});

it('pauses provider idle timing during downstream backpressure', async () => {
  const server = await completionServer();
  try {
    const actor = providerActor(server.baseUrl, {
      responseStartTimeoutMilliseconds: null,
      streamEventIdleTimeoutMilliseconds: 10,
    });
    let held = false;
    await expect(
      actor.stream(
        request(async () => {
          if (!held) {
            held = true;
            await new Promise((resolve) => setTimeout(resolve, 40));
          }
        })
      )
    ).resolves.toMatchObject({ message: { text: 'proposed update' } });
  } finally {
    await server.close();
  }
});

it('cancels and joins the real provider when the consumer cancels during reasoning', async () => {
  const release = Promise.withResolvers<void>();
  const server = await completionServer({ afterFirstChunk: release.promise });
  try {
    const controller = new AbortController();
    const failure = new Error('stop generation');
    const events: ModelGenerationEvent[] = [];
    const actor = providerActor(server.baseUrl);
    await expect(
      actor.stream(
        request((event) => {
          events.push(event);
          controller.abort(failure);
          return Promise.resolve();
        }, controller.signal)
      )
    ).rejects.toBe(failure);
    await server.clientClosed;
    expect(events.map((event) => event.type)).toEqual(['reasoning-delta']);
  } finally {
    release.resolve();
    await server.close();
  }
});

it('keeps transport idle timeout distinct from Actor timeout during a streamed generation', async () => {
  const release = Promise.withResolvers<void>();
  const server = await completionServer({ afterFirstChunk: release.promise });
  try {
    const actor = providerActor(server.baseUrl, {
      responseStartTimeoutMilliseconds: null,
      streamEventIdleTimeoutMilliseconds: 20,
    });
    await expect(actor.stream(request(() => Promise.resolve()))).rejects.toMatchObject({
      code: 'MODEL_PROVIDER_STREAM_IDLE_TIMEOUT',
    });
    await server.clientClosed;
  } finally {
    release.resolve();
    await server.close();
  }
});
