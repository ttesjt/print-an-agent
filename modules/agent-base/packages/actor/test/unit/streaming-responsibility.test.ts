import { expect, it } from 'vitest';
import {
  defineAssistantModelMessage,
  defineProviderModelExecutionProvenance,
} from '@print-an-agent/model-invocation-core';
import {
  createActorCatalog,
  createResponsibilityCatalog,
  createResponsibilityRouter,
  parseResponsibilityId,
} from '../../src/index.js';

it('routes a streaming-only Actor and composes Agent Responsibility instructions', async () => {
  const actors = createActorCatalog({
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
