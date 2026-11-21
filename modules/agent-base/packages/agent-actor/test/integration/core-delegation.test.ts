import { expect, it } from 'vitest';
import {
  requireInteractionCapability,
  parseModelExecutionProvenanceType,
  type AssistantModelMessage,
} from '@print-an-agent/model-invocation-core';
import { createAgentActorCatalog, MAIN_ACTOR_ID } from '@print-an-agent/agent-actor';
import { EMPTY_TOOL_RUNTIME, fakeEngine, type FakeEngineInspection } from '../support/fixtures.js';
import { expectActorError } from '../support/actor-errors.js';
function inspection(): FakeEngineInspection {
  return { interactionRequests: [], directRequests: [] };
}
it('normalizes mutable Engine terminal events and results at the resolved Actor boundary', async () => {
  const mutableEvidence = { target: { id: 'target-1' } };
  const mutableUsage = {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2,
  };
  const message: AssistantModelMessage = {
    role: 'assistant',
    text: 'completed',
    provenance: {
      kind: 'engine-defined',
      type: parseModelExecutionProvenanceType('test.target'),
      evidence: mutableEvidence,
    },
    stopReason: 'stop',
    usage: mutableUsage,
    timestamp: 1,
  };
  const catalog = createAgentActorCatalog({
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
        interact: async (request) => {
          await request.emit({ type: 'assistant-complete', message });
          return { message };
        },
      },
    ],
  });
  const actor = await catalog.resolve(MAIN_ACTOR_ID);
  let emitted: AssistantModelMessage | undefined;
  const result = await requireInteractionCapability(actor).interact({
    instructions: '',
    history: [],
    prompt: { role: 'user', text: 'hello', timestamp: 1 },
    tools: EMPTY_TOOL_RUNTIME,
    maxModelTurns: 1,
    maxOutputCharacters: 100,
    signal: new AbortController().signal,
    emit: (event) => {
      if (event.type === 'assistant-complete') emitted = event.message;
      return Promise.resolve();
    },
  });
  mutableEvidence.target.id = 'mutated';
  mutableUsage.totalTokens = 99;
  for (const normalized of [emitted, result.message]) {
    expect(normalized?.provenance).toMatchObject({
      kind: 'engine-defined',
      evidence: { target: { id: 'target-1' } },
    });
    expect(normalized?.usage.totalTokens).toBe(2);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized?.provenance)).toBe(true);
  }
});

it('fails an unsupported invocation before calling the Engine handler', async () => {
  const calls = inspection();
  const directOnly = fakeEngine('engine', calls);
  const catalog = createAgentActorCatalog({
    actors: [
      {
        id: 'main',
        engineId: 'engine',
        capabilityLimits: { invocationModes: ['direct'] },
      },
    ],
    engines: [directOnly],
  });
  const actor = await catalog.resolve(MAIN_ACTOR_ID);
  expect(actor).not.toHaveProperty('interact');
  expectActorError(() => requireInteractionCapability(actor), 'ACTOR_INVOCATION_UNSUPPORTED');
  expect(calls.interactionRequests).toHaveLength(0);
});
