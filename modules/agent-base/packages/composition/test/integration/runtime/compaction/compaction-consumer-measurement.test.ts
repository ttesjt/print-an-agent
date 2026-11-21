import {
  BUILT_IN_RESPONSIBILITIES,
  createAgentActorCatalog,
  createResponsibilityCatalog,
  FOREGROUND_INTERACTION_RESPONSIBILITY_ID,
} from '@print-an-agent/agent-actor';
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { MemorySessionAdapter } from '@print-an-agent/base-local-adapters';
import { DEFAULT_SESSION_COMPACTION_POLICY } from '@print-an-agent/base-session';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
  type ActorId,
  type TextTokenInput,
  type TokenCounter,
} from '@print-an-agent/model-invocation-core';
import { expect, it, vi } from 'vitest';
import { composeAgent } from '../../../../src/index.js';
import {
  compactionMessage,
  seedCompactionSession,
} from '../../../support/runtime/compaction-fixture.js';

async function fixture(
  accuracy: 'exact' | 'estimated' = 'exact',
  override?: TokenCounter<TextTokenInput>,
  drift = false
) {
  const consumerMeasure = vi.fn((input: TextTokenInput) =>
    Promise.resolve({ tokens: input.text.length * 2, accuracy })
  );
  const producerMeasure = vi.fn(() => Promise.resolve({ tokens: 1, accuracy: 'exact' as const }));
  const consumer = createTokenCounter({
    measurementRef: 'test:consumer',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: consumerMeasure,
  });
  const producer = createTokenCounter({
    measurementRef: 'test:producer',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: producerMeasure,
  });
  const identity = defineAgentIdentity({ id: 'consumer-counting' });
  const session = new MemorySessionAdapter();
  const reference = await seedCompactionSession(session, identity);
  const outputs = ['long', 'ok'];
  const complete = vi.fn(() =>
    Promise.resolve({ message: compactionMessage(outputs.shift() ?? 'ok') })
  );
  const actorCatalog = createAgentActorCatalog({
    actors: [
      { id: 'main', engineId: 'writer' },
      { id: 'reader', engineId: 'reader' },
      { id: 'summary', engineId: 'writer' },
    ],
    engines: [
      {
        id: 'reader',
        textTokenCounter: consumer,
        capabilities: {
          invocationModes: ['interaction'],
          interaction: { streamable: true },
          inputMediaTypes: ['text'],
          cancellation: true,
          toolCalling: true,
          structuredOutput: false,
        },
        interact: async (request) => {
          const message = compactionMessage('unused foreground fixture');
          await request.emit({ type: 'assistant-complete', message });
          return { message };
        },
      },
      {
        id: 'writer',
        textTokenCounter: producer,
        capabilities: {
          invocationModes: ['direct'],
          inputMediaTypes: ['text'],
          cancellation: true,
          toolCalling: false,
          structuredOutput: false,
        },
        complete,
      },
    ],
  });
  let consumerResolutions = 0;
  const catalog = {
    ...actorCatalog,
    resolve: async (actorId: ActorId) => {
      const actor = await actorCatalog.resolve(actorId);
      return drift && actorId === 'reader' && ++consumerResolutions > 1
        ? Object.freeze({ ...actor, textTokenCounter: producer })
        : actor;
    },
  };
  const agent = composeAgent({
    identity,
    session,
    actorCatalog: catalog,
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES.map((definition) => ({
        ...definition,
        actors: [
          {
            actorId:
              definition.id === FOREGROUND_INTERACTION_RESPONSIBILITY_ID ? 'reader' : 'summary',
            enabled: true,
          },
        ],
      })),
    }),
    sessionCompactionPolicy: {
      ...DEFAULT_SESSION_COMPACTION_POLICY,
      maxContextTokens: 5,
      target: { maxTokens: 5 },
    },
    ...(override === undefined ? {} : { sessionCompactionTokenCounter: override }),
  });
  return { agent, session, reference, consumerMeasure, producerMeasure, complete, actorCatalog };
}

it('routes acceptance to the foreground consumer, not main Actor or compaction Actor', async () => {
  const result = await fixture();
  await expect(
    result.agent.invoke('compactSession', { sessionId: result.reference.sessionId })
  ).resolves.toMatchObject({ status: 'compacted' });
  expect(result.complete).toHaveBeenCalledTimes(2);
  expect(result.consumerMeasure).toHaveBeenCalledTimes(3);
  expect(result.producerMeasure).not.toHaveBeenCalled();
  expect((await result.session.readCompaction(result.reference))?.context.text).toBe('ok');
});

it('allows explicit host measurement without invoking either model-bound counter', async () => {
  const override = createTokenCounter({
    measurementRef: 'test:host',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: () => Promise.resolve({ tokens: 1, accuracy: 'exact' }),
  });
  const result = await fixture('exact', override);
  await result.agent.invoke('compactSession', { sessionId: result.reference.sessionId });
  expect(result.complete).toHaveBeenCalledOnce();
  expect(result.consumerMeasure).not.toHaveBeenCalled();
  expect(result.producerMeasure).not.toHaveBeenCalled();
});

it('rejects estimates rather than retrying or publishing them as exact evidence', async () => {
  const result = await fixture('estimated');
  await expect(
    result.agent.invoke('compactSession', { sessionId: result.reference.sessionId })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_MEASUREMENT_INEXACT' });
  expect(result.complete).toHaveBeenCalledOnce();
  expect(await result.session.readCompaction(result.reference)).toBeUndefined();
});

it('rejects consumer measurement identity drift before publication', async () => {
  const result = await fixture('exact', undefined, true);
  await expect(
    result.agent.invoke('compactSession', { sessionId: result.reference.sessionId })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_TOKENIZER_FAILED' });
  expect(result.complete).toHaveBeenCalledTimes(2);
  expect(result.producerMeasure).not.toHaveBeenCalled();
  expect(await result.session.readCompaction(result.reference)).toBeUndefined();
});
