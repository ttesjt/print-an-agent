import {
  BUILT_IN_RESPONSIBILITIES,
  createAgentActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
  SESSION_COMPACTION_RESPONSIBILITY_ID,
} from '@print-an-agent/agent-actor';
import { MemoryAgentTraceAdapter } from '@print-an-agent/base-local-adapters';
import { expect, it } from 'vitest';
import {
  composeAgent,
  FOREGROUND_AGENT_OPERATION_NAME,
  SESSION_COMPACTION_AGENT_OPERATION_NAME,
} from '../../../../src/index.js';
import { customAssistantMessage } from '../../../support/runtime/agent-api.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';

it('routes foreground interaction and compaction to different custom Engines', async () => {
  const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
  let interactionCalls = 0;
  let directCalls = 0;
  const actorCatalog = createAgentActorCatalog({
    actors: [
      { id: MAIN_ACTOR_ID, engineId: 'foreground-engine' },
      { id: 'compactor', engineId: 'compaction-engine' },
    ],
    engines: [
      {
        id: 'foreground-engine',
        capabilities: {
          invocationModes: ['interaction'],
          inputMediaTypes: ['text'],
          interaction: { streamable: true },
          toolCalling: false,
          structuredOutput: false,
          cancellation: true,
        },
        interact: async (request) => {
          interactionCalls += 1;
          const message = customAssistantMessage(`foreground-${interactionCalls}`);
          await request.emit({ type: 'interaction-start' });
          await request.emit({ type: 'turn-start' });
          await request.emit({ type: 'assistant-complete', message });
          await request.emit({ type: 'turn-end' });
          await request.emit({ type: 'interaction-end' });
          return Object.freeze({ message });
        },
      },
      {
        id: 'compaction-engine',
        capabilities: {
          invocationModes: ['direct'],
          inputMediaTypes: ['text'],
          toolCalling: false,
          structuredOutput: false,
          cancellation: true,
        },
        complete: () => {
          directCalls += 1;
          return Promise.resolve(
            Object.freeze({ message: customAssistantMessage('custom compacted context') })
          );
        },
      },
    ],
  });
  const responsibilityCatalog = createResponsibilityCatalog({
    responsibilities: BUILT_IN_RESPONSIBILITIES.map((definition) =>
      definition.id === SESSION_COMPACTION_RESPONSIBILITY_ID
        ? {
            ...definition,
            actors: [{ actorId: 'compactor', enabled: true }],
          }
        : definition
    ),
  });
  let requestSequence = 0;
  const agent = composeAgent({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'custom-engine-agent' },
    actorCatalog,
    responsibilityCatalog,
    createRunId: () => `custom-request-${++requestSequence}`,
    createCompactionRunId: () => 'custom-compaction',
    observability: { sink: trace, clock: () => 1 },
  });
  const { sessionId } = await agent.resources.session.resolve({ agentId: agent.identity.id });

  for (const message of ['one', 'two', 'three', 'four']) {
    await agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, {
      message,
      sessionId: sessionId,
    });
  }
  await expect(
    agent.invoke(SESSION_COMPACTION_AGENT_OPERATION_NAME, {
      sessionId: sessionId,
    })
  ).resolves.toMatchObject({ status: 'compacted', compactedTurnCount: 2 });

  expect(interactionCalls).toBe(4);
  expect(directCalls).toBe(1);
  expect(
    trace
      .inspect({ agentRunId: 'custom-compaction' })
      .events.find((event) => event.type === 'actor-resolved')
  ).toMatchObject({
    responsibilityId: SESSION_COMPACTION_RESPONSIBILITY_ID,
    actorId: 'compactor',
    engineId: 'compaction-engine',
    invocationMode: 'direct',
  });
  const modelResponse = trace
    .inspect()
    .events.find((event) => event.type === 'model-response-completed');
  expect(modelResponse).toMatchObject({
    engineId: 'foreground-engine',
    provenanceKind: 'engine-defined',
    provenanceType: 'test.custom-target',
  });
  expect(JSON.stringify(modelResponse)).not.toContain('PRIVATE_ARTIFACT_ID');
  expect(JSON.stringify(modelResponse)).not.toContain('foreground-1');
});
