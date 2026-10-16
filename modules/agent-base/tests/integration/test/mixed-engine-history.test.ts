import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@ta-agent/base-actor';
import { composeAgent, createDeterministicAgentAPI } from '@ta-agent/base-composition';
import { MemorySessionAdapter } from '@ta-agent/base-local-adapters';
import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
  type ModelMessage,
} from '@ta-agent/model-invocation-core';
import { parseSessionId } from '@ta-agent/base-session';
import { describe, expect, it } from 'vitest';

function customAssistantMessage(text: string) {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineEngineDefinedModelExecutionProvenance({
      type: 'consumer.runtime-target',
      evidence: { targetId: 'custom-target' },
    }),
    stopReason: 'stop',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    timestamp: 2,
  });
}

describe('mixed Engine history', () => {
  it('retains provenance across provider, custom Engine, and provider executions', async () => {
    const session = new MemorySessionAdapter();
    const firstProvider = createDeterministicAgentAPI({
      identity: { id: 'mixed-history-agent' },
      session,
      createRunId: () => 'provider-run-1',
      provider: {
        providerId: 'source-provider',
        modelId: 'source-model',
        responses: [{ status: 'success', text: 'provider answer' }],
      },
    });
    const { sessionId } = await firstProvider.run({ message: 'first' });

    let customHistory: readonly ModelMessage[] | undefined;
    const customAgent = composeAgent({
      identity: { id: 'mixed-history-agent' },
      session,
      createRunId: () => 'custom-run-2',
      actorCatalog: createActorCatalog({
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
            interact: async (request) => {
              customHistory = request.history;
              const message = customAssistantMessage('custom answer');
              await request.emit({ type: 'interaction-start' });
              await request.emit({ type: 'turn-start' });
              await request.emit({ type: 'assistant-complete', message });
              await request.emit({ type: 'turn-end' });
              await request.emit({ type: 'interaction-end' });
              return { message };
            },
          },
        ],
      }),
      responsibilityCatalog: createResponsibilityCatalog({
        responsibilities: BUILT_IN_RESPONSIBILITIES,
      }),
    });
    await customAgent.invoke('foreground', { sessionId, message: 'second' });

    expect(customHistory).toMatchObject([
      { role: 'user', text: 'first' },
      {
        role: 'assistant',
        text: 'provider answer',
        provenance: {
          kind: 'provider-model',
          provider: 'source-provider',
          model: 'source-model',
        },
      },
    ]);

    const currentProvider = createDeterministicAgentAPI({
      identity: { id: 'mixed-history-agent' },
      session,
      createRunId: () => 'provider-run-3',
      provider: {
        providerId: 'current-provider',
        modelId: 'current-model',
        responses: [{ status: 'success', text: 'current answer' }],
      },
    });
    await currentProvider.run({ sessionId, message: 'third' });

    expect(currentProvider.inspectDeterministicProvider().requests[0]?.messages).toMatchObject([
      { role: 'user', text: 'first' },
      {
        role: 'assistant',
        text: 'provider answer',
        provenance: {
          kind: 'provider-model',
          provider: 'source-provider',
          model: 'source-model',
        },
      },
      { role: 'user', text: 'second' },
      {
        role: 'assistant',
        text: 'custom answer',
        provenance: {
          kind: 'provider-model',
          provider: 'current-provider',
          model: 'current-model',
        },
      },
      { role: 'user', text: 'third' },
    ]);

    expect(
      await session.inspect({
        agentId: currentProvider.identity.id,
        sessionId: parseSessionId(sessionId),
      })
    ).toMatchObject({
      turns: [
        {
          status: 'completed',
          assistantMessage: {
            provenance: {
              kind: 'provider-model',
              provider: 'source-provider',
              model: 'source-model',
            },
          },
        },
        {
          status: 'completed',
          assistantMessage: {
            provenance: {
              kind: 'engine-defined',
              type: 'consumer.runtime-target',
              evidence: { targetId: 'custom-target' },
            },
          },
        },
        {
          status: 'completed',
          assistantMessage: {
            provenance: {
              kind: 'provider-model',
              provider: 'current-provider',
              model: 'current-model',
            },
          },
        },
      ],
    });
  });
});
