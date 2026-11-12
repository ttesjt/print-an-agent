import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@print-an-agent/base-actor';
import { type ActorInteractionHandler } from '@print-an-agent/model-invocation-core';
import { MemoryAgentTraceAdapter } from '@print-an-agent/base-local-adapters';
import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
} from '@print-an-agent/model-invocation-core';
import { DEFAULT_REQUEST_POLICY } from '@print-an-agent/base-request';
import { describe, expect, it } from 'vitest';
import { composeAgent, FOREGROUND_AGENT_OPERATION_NAME } from '../../src/index.js';

function customMessage() {
  return defineAssistantModelMessage({
    role: 'assistant',
    text: 'custom response',
    provenance: defineEngineDefinedModelExecutionProvenance({
      type: 'example.custom-runtime',
      evidence: { privateTarget: 'must-not-enter-trace' },
    }),
    stopReason: 'stop',
    usage: {
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 5,
    },
    timestamp: 1,
  });
}

function createCustomAgent(
  trace: MemoryAgentTraceAdapter,
  interact: ActorInteractionHandler,
  maxModelTurns = DEFAULT_REQUEST_POLICY.maxModelTurns
) {
  const actorCatalog = createActorCatalog({
    actors: [{ id: MAIN_ACTOR_ID, engineId: 'custom-engine' }],
    engines: [
      {
        id: 'custom-engine',
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
  });
  return composeAgent({
    identity: { id: 'custom-observability-agent' },
    actorCatalog,
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities: BUILT_IN_RESPONSIBILITIES,
    }),
    createRunId: () => 'custom-observability-run',
    requestPolicy: { ...DEFAULT_REQUEST_POLICY, maxModelTurns },
    observability: { sink: trace, clock: () => 1 },
  });
}

describe('generic model-turn observability', () => {
  it('records a safe minimum model-turn summary for a custom Engine with terminal-only events', async () => {
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
    const message = customMessage();
    const agent = createCustomAgent(trace, async (request) => {
      await request.emit({ type: 'assistant-complete', message });
      return { message };
    });

    await expect(
      agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, { message: 'run custom engine' })
    ).resolves.toMatchObject({ message });

    const events = trace.inspect({ agentRunId: 'custom-observability-run' }).events;
    expect(events.every((event) => event.schemaVersion === 2)).toBe(true);
    expect(events.some((event) => event.type === 'model-turn-started')).toBe(false);
    expect(events.find((event) => event.type === 'model-response-completed')).toMatchObject({
      modelTurnIndex: 1,
      engineId: 'custom-engine',
      provenanceKind: 'engine-defined',
      provenanceType: 'example.custom-runtime',
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      outputCharacters: 15,
    });
    expect(events.find((event) => event.type === 'agent-loop-completed')).toMatchObject({
      modelTurns: 1,
    });
    expect(JSON.stringify(events)).not.toContain('must-not-enter-trace');
    expect(JSON.stringify(events)).not.toContain('custom response');
  });

  it('enforces the request model-turn budget for a custom Engine', async () => {
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
    const agent = createCustomAgent(
      trace,
      async (request) => {
        await request.emit({ type: 'turn-start' });
        await request.emit({ type: 'turn-end' });
        await request.emit({ type: 'turn-start' });
        const message = customMessage();
        await request.emit({ type: 'assistant-complete', message });
        return { message };
      },
      1
    );

    await expect(
      agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, { message: 'exceed model-turn budget' })
    ).rejects.toMatchObject({ code: 'MODEL_TURN_LIMIT_EXCEEDED' });

    const events = trace.inspect({ agentRunId: 'custom-observability-run' }).events;
    expect(
      events
        .filter((event) => event.type === 'model-turn-started')
        .map((event) => event.modelTurnIndex)
    ).toEqual([1]);
    expect(events.find((event) => event.type === 'agent-loop-failed')).toMatchObject({
      modelTurns: 1,
      errorCode: 'MODEL_TURN_LIMIT_EXCEEDED',
    });
    expect(events.some((event) => event.type === 'model-response-completed')).toBe(false);
  });
});
