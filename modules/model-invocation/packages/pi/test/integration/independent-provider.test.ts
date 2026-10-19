import { expect, it } from 'vitest';
import {
  createActor,
  requireCompletionCapability,
  requireInteractionCapability,
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  requireActorTextTokenCounter,
} from '@ta-agent/model-invocation-core';
import { createPiFauxRuntime, createPiProviderRuntime } from '../../src/index.js';
import { completionServer } from '../support/completion-server.js';

it('completes through the real Pi provider boundary without any Agent Base package', async () => {
  const server = await completionServer();
  try {
    const profile = createPiProviderRuntime({
      textTokenCounter: createTokenCounter({
        measurementRef: 'test:standalone-text',
        inputContract: TEXT_TOKEN_INPUT_CONTRACT,
        measure: (input) => Promise.resolve({ tokens: input.text.length, accuracy: 'exact' }),
      }),
      provider: {
        kind: 'openai-compatible',
        reference: { provider: 'fixture', model: 'fixture', baseUrl: server.baseUrl },
        contextWindowTokens: 4096,
        maxOutputTokens: 256,
        supportsReasoning: true,
        compatibility: { supportsDeveloperRole: false },
      },
    });
    const actor = requireCompletionCapability(
      createActor({ id: 'proposer', engine: profile.actorEngine })
    );
    const counter = requireActorTextTokenCounter(actor);
    expect(
      (await counter.measure({ kind: 'text', text: 'hello' }, new AbortController().signal)).tokens
    ).toBe(5);
    expect(profile.inspect().textTokenCounter).toEqual(counter.descriptor);
    expect(server.requests).toHaveLength(0);
    const result = await actor.complete({
      instructions: 'Propose an update.',
      messages: [{ role: 'user', text: 'New experience.', timestamp: 1 }],
      maxOutputCharacters: 100,
      signal: new AbortController().signal,
    });
    expect(result.message).toMatchObject({
      text: 'proposed update',
      provenance: { kind: 'provider-model', provider: 'fixture', model: 'fixture' },
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'Propose an update.' },
        { role: 'user', content: 'New experience.' },
      ],
    });
  } finally {
    await server.close();
  }
});

it('preserves a rejected borrowed tool port without knowing the consumer error class', async () => {
  const failure = new Error('consumer-owned tool failure');
  const profile = createPiFauxRuntime({
    responses: [
      { status: 'tool-call', callId: 'work-1', name: 'work', arguments: {} },
      { status: 'success', text: 'unreachable' },
    ],
  });
  const actor = requireInteractionCapability(
    createActor({ id: 'worker', engine: profile.actorEngine })
  );
  await expect(
    actor.interact({
      instructions: '',
      history: [],
      prompt: { role: 'user', text: 'work', timestamp: 1 },
      tools: {
        tools: [
          {
            name: 'work',
            description: 'Work',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
              additionalProperties: false,
            },
          },
        ],
        execute: () => Promise.reject(failure),
      },
      maxModelTurns: 2,
      maxOutputCharacters: 100,
      signal: new AbortController().signal,
      emit: () => Promise.resolve(),
    })
  ).rejects.toBe(failure);
  expect(profile.inspect().callCount).toBe(1);
});
