import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@print-an-agent/base-actor';
import {
  MemoryAgentTraceAdapter,
  MemoryOutputSink,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
} from '@print-an-agent/base-local-adapters';
import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
} from '@print-an-agent/model-invocation-core';
import { parseRequestIdempotencyKey } from '@print-an-agent/base-request';
import { parseSessionId } from '@print-an-agent/base-session';
import { describe, expect, it } from 'vitest';
import { composeAgent, FOREGROUND_AGENT_OPERATION_NAME } from '../../src/index.js';

function assistantMessage(text: string) {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineEngineDefinedModelExecutionProvenance({
      type: 'test.runtime-target',
      evidence: { targetId: 'target-1' },
    }),
    stopReason: 'stop',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    timestamp: 1,
  });
}

describe('composed Agent Engine protocol', () => {
  it('fails Session, journal, and output without committing a terminal followed by content', async () => {
    const session = new MemorySessionAdapter();
    const journal = new MemoryRequestJournalAdapter(() => 1);
    const output = new MemoryOutputSink();
    const trace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
    const actorCatalog = createActorCatalog({
      actors: [{ id: MAIN_ACTOR_ID, engineId: 'invalid-event-order-engine' }],
      engines: [
        {
          id: 'invalid-event-order-engine',
          capabilities: {
            invocationModes: ['interaction'],
            inputMediaTypes: ['text'],
            interaction: { streamable: true },
            toolCalling: false,
            structuredOutput: false,
            cancellation: true,
          },
          interact: async (request) => {
            await request.emit({ type: 'text-delta', delta: 'partial' });
            await request.emit({
              type: 'assistant-complete',
              message: assistantMessage('complete message'),
            });
            await request.emit({ type: 'text-delta', delta: 'late output' });
            return { message: assistantMessage('complete message') };
          },
        },
      ],
    });
    const agent = composeAgent({
      identity: { id: 'protocol-agent' },
      actorCatalog,
      responsibilityCatalog: createResponsibilityCatalog({
        responsibilities: BUILT_IN_RESPONSIBILITIES,
      }),
      session,
      requestJournal: journal,
      createRunId: () => 'protocol-run',
      observability: { sink: trace, clock: () => 1 },
    });
    const { sessionId } = await agent.resources.session.resolve({ agentId: agent.identity.id });

    await expect(
      agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, {
        sessionId: sessionId,
        idempotencyKey: 'protocol-request',
        message: 'start',
        outputSink: output,
      })
    ).rejects.toMatchObject({ code: 'ACTOR_ENGINE_PROTOCOL_INVALID' });

    expect(output.inspect()).toMatchObject({
      status: 'failed',
      events: [{ type: 'text-delta', delta: 'partial' }],
      failure: { code: 'ACTOR_ENGINE_PROTOCOL_INVALID' },
    });
    expect(
      await session.inspect({
        agentId: agent.identity.id,
        sessionId: parseSessionId(sessionId),
      })
    ).toMatchObject({
      turns: [
        {
          status: 'failed',
          failureCode: 'ACTOR_ENGINE_PROTOCOL_INVALID',
        },
      ],
    });
    expect(
      await journal.inspect({
        agentId: agent.identity.id,
        sessionId: parseSessionId(sessionId),
        idempotencyKey: parseRequestIdempotencyKey('protocol-request'),
      })
    ).toMatchObject({
      status: 'failed',
      failure: { code: 'ACTOR_ENGINE_PROTOCOL_INVALID' },
    });
    const events = trace.inspect({ agentRunId: 'protocol-run' }).events;
    expect(events.some((event) => event.type === 'model-response-completed')).toBe(false);
    expect(events.find((event) => event.type === 'agent-loop-failed')).toMatchObject({
      errorCode: 'ACTOR_ENGINE_PROTOCOL_INVALID',
    });
  });
});
