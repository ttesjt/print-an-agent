import { fakeEngine, type FakeEngineInspection } from '../../support/fixtures.js';
import { expect, it } from 'vitest';
import {
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
} from '@print-an-agent/model-invocation-core';
import {
  createAgentActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
  parseResponsibilityId,
} from '../../../src/index.js';

it('routes a streaming-only Actor and composes Agent Responsibility instructions', async () => {
  const actors = createAgentActorCatalog({
    actors: [{ id: 'main', engineId: 'engine', instructions: 'Actor' }],
    engines: [
      {
        id: 'engine',
        capabilities: {
          invocationModes: ['stream'],
          inputMediaTypes: ['text'],
          cancellation: true,
          structuredOutput: false,
          toolCalling: false,
        },
        stream: async (request) => {
          expect(request.instructions).toBe('Actor\n\nResponsibility\n\nCaller');
          const message = defineAssistantModelMessage({
            role: 'assistant',
            text: 'answer',
            stopReason: 'stop',
            timestamp: 1,
            provenance: defineProviderModelExecutionProvenance({
              provider: 'fixture',
              model: 'fixture',
            }),
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 0,
            },
          });
          await request.emit({ type: 'assistant-complete', message });
          return { message };
        },
      },
    ],
  });
  const router = createResponsibilityRouter({
    actorCatalog: actors,
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: [
        {
          id: 'proposal',
          instructions: 'Responsibility',
          requiredCapabilities: { invocationMode: 'stream' },
        },
      ],
    }),
  });
  const responsibility = await router.resolve(parseResponsibilityId('proposal'));
  if (responsibility.stream === undefined) throw new Error('Missing stream capability');
  await expect(
    responsibility.stream({
      instructions: 'Caller',
      messages: [],
      maxOutputCharacters: 100,
      maxReasoningCharacters: 100,
      signal: new AbortController().signal,
      emit: () => Promise.resolve(),
    })
  ).resolves.toMatchObject({ message: { text: 'answer' } });
});

it('delegates direct invocation with Actor/Responsibility/caller instructions and independent revisions', async () => {
  const calls: FakeEngineInspection = { interactionRequests: [], directRequests: [] };
  const actorCatalog = createAgentActorCatalog({
    revision: 3,
    actors: [{ id: 'main', engineId: 'engine', instructions: 'Actor', allowedTools: ['search'] }],
    engines: [fakeEngine('engine', calls)],
  });
  const responsibilityCatalog = createResponsibilityCatalog({
    revision: 7,
    responsibilities: [
      {
        id: 'answer',
        instructions: 'Responsibility',
        allowedTools: ['edit'],
        requiredCapabilities: { invocationMode: 'direct' },
      },
    ],
  });
  const resolved = await createResponsibilityRouter({
    actorCatalog,
    responsibilityCatalog,
  }).resolve(parseResponsibilityId('answer'));
  const signal = new AbortController().signal;
  await expect(
    resolved.complete({ instructions: 'Caller', messages: [], signal, maxOutputCharacters: 100 })
  ).resolves.toMatchObject({ message: { text: 'engine:direct' } });
  expect(calls.directRequests[0]?.instructions).toBe('Actor\n\nResponsibility\n\nCaller');
  expect(calls.directRequests[0]?.signal).toBe(signal);
  expect(resolved.catalogRevision).toBe(7);
  expect(resolved.actor.catalogRevision).toBe(3);
  expect(resolved.allowedTools).toEqual(['edit']);
  expect(resolved.actor.allowedTools).toEqual(['search']);
});
