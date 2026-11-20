import {
  MemoryAgentTraceAdapter,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
  SqliteRequestJournalAdapter,
  SqliteSessionAdapter,
} from '@print-an-agent/base-local-adapters';
import {
  AgentRequestError,
  createRequestFingerprint,
  parseRequestIdempotencyKey,
  RequestReplayFailedError,
} from '@print-an-agent/base-request';
import { parseSessionId } from '@print-an-agent/base-session';
import {
  createToolRegistry,
  defineTool,
  type ToolExecutionRequest,
} from '@print-an-agent/base-tool';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { responsibilitiesAllowingTools } from '../../../support/runtime/agent-api.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';
import { LifecycleRecordingOutputSink } from '../../../support/runtime/output-sinks.js';

it('replays a durable request after restart without repeating Pi, tools, or Session turns', async () => {
  type AddInput = Readonly<{ left: number; right: number }>;
  const directory = mkdtempSync(join(tmpdir(), 'ta-agent-durable-replay-'));
  const databasePath = join(directory, 'agent.sqlite');
  const handler = vi.fn(({ arguments: input }: ToolExecutionRequest<AddInput>) =>
    Promise.resolve({ text: `PRIVATE_TOOL_RESULT_${input.left + input.right}` })
  );
  const add = defineTool({
    name: 'add',
    description: 'Adds two numbers.',
    parameters: {
      type: 'object',
      properties: { left: { type: 'number' }, right: { type: 'number' } },
      required: ['left', 'right'],
      additionalProperties: false,
    },
    execute: handler,
  });
  try {
    const firstSession = new SqliteSessionAdapter({ databasePath });
    const firstJournal = new SqliteRequestJournalAdapter({ databasePath });
    const firstTrace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
    const firstAgent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'replay-assistant' },
      session: firstSession,
      requestJournal: firstJournal,
      toolRegistry: createToolRegistry([add]),
      mainActor: { allowedTools: ['add'] },
      responsibilities: responsibilitiesAllowingTools(['add']),
      productToolAllowList: ['add'],
      runtimeToolAllowList: ['add'],
      createRunId: () => 'original-request',
      observability: { sink: firstTrace, clock: () => 1 },
      provider: {
        responses: [
          { status: 'tool-call', callId: 'add-1', name: 'add', arguments: { left: 2, right: 3 } },
          { status: 'success', text: 'done' },
        ],
      },
    });
    const { sessionId } = await firstAgent.agent.resources.session.resolve({
      agentId: firstAgent.identity.id,
    });
    const first = await firstAgent.run({
      sessionId: sessionId,
      idempotencyKey: 'logical-request-1',
      message: 'add two and three',
    });
    expect(JSON.stringify(firstTrace.inspect().events)).not.toContain('PRIVATE_TOOL_RESULT_5');

    const reopenedSession = new SqliteSessionAdapter({ databasePath });
    const reopenedJournal = new SqliteRequestJournalAdapter({ databasePath });
    const replayTrace = new MemoryAgentTraceAdapter({ maxEvents: 128 });
    const reopenedAgent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'replay-assistant' },
      session: reopenedSession,
      requestJournal: reopenedJournal,
      toolRegistry: createToolRegistry([add]),
      mainActor: { allowedTools: ['add'] },
      responsibilities: responsibilitiesAllowingTools(['add']),
      productToolAllowList: ['add'],
      runtimeToolAllowList: ['add'],
      createRunId: () => 'retry-request',
      createWorkflowRunId: () => 'retry-workflow',
      observability: { sink: replayTrace, clock: () => 1 },
      provider: { responses: [{ status: 'success', text: 'must not execute' }] },
    });
    const replaySink = new LifecycleRecordingOutputSink();
    const replayed = await reopenedAgent.run({
      sessionId: sessionId,
      idempotencyKey: 'logical-request-1',
      message: 'add two and three',
      outputSink: replaySink,
    });

    expect(replayed).toEqual(first);
    expect(reopenedAgent.inspectDeterministicProvider().callCount).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(replaySink.calls).toEqual(['open', 'write', 'close']);
    expect(replaySink.inspect().events).toEqual([{ type: 'text-delta', delta: 'done' }]);
    expect(
      (
        await reopenedSession.inspect({
          agentId: reopenedAgent.identity.id,
          sessionId: parseSessionId(sessionId),
        })
      )?.turns
    ).toHaveLength(1);
    const journalEntry = await reopenedJournal.inspect({
      agentId: reopenedAgent.identity.id,
      sessionId: parseSessionId(sessionId),
      idempotencyKey: parseRequestIdempotencyKey('logical-request-1'),
    });
    expect(journalEntry).toMatchObject({ status: 'completed', requestId: 'original-request' });
    expect(JSON.stringify(journalEntry)).not.toContain('add two and three');
    expect(JSON.stringify(journalEntry)).not.toContain('PRIVATE_TOOL_RESULT_5');
    const replayEvents = replayTrace.inspect({ agentRunId: 'retry-request' }).events;
    const replayEventTypes = replayEvents.map((event) => event.type);
    expect(replayEventTypes).toContain('request-replay-resolved');
    expect(replayEvents.find((event) => event.type === 'request-replay-resolved')).toMatchObject({
      status: 'completed',
    });
    expect(replayEventTypes).toContain('output-publication-completed');
    expect(replayEventTypes).not.toContain('agent-loop-started');
    expect(replayEventTypes).not.toContain('model-turn-started');
    expect(replayEventTypes).not.toContain('tool-call-started');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('fails existing active, failed, and conflicting replay authorities without execution', async () => {
  const journal = new MemoryRequestJournalAdapter(() => 1);
  const session = new MemorySessionAdapter();
  const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
  const runIds = ['active-retry', 'failed-retry', 'conflict-retry'];
  let runIndex = 0;
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'replay-guard' },
    session,
    requestJournal: journal,
    createRunId: () => runIds[runIndex++] ?? 'unexpected-retry',
    observability: { sink: trace, clock: () => 1 },
    provider: { responses: [{ status: 'success', text: 'must not execute' }] },
  });
  const agentId = agent.identity.id;
  const { sessionId } = await session.resolve({ agentId });
  const activeKey = parseRequestIdempotencyKey('active-key');
  const failedKey = parseRequestIdempotencyKey('failed-key');
  const conflictKey = parseRequestIdempotencyKey('conflict-key');
  await journal.claim({
    agentId,
    sessionId,
    idempotencyKey: activeKey,
    fingerprint: createRequestFingerprint({ message: 'active' }),
    requestId: 'active-owner',
  });
  await journal.claim({
    agentId,
    sessionId,
    idempotencyKey: failedKey,
    fingerprint: createRequestFingerprint({ message: 'failed' }),
    requestId: 'failed-owner',
  });
  await journal.fail({
    agentId,
    sessionId,
    idempotencyKey: failedKey,
    requestId: 'failed-owner',
    failure: { code: 'MODEL_FAILED', message: 'original failure' },
  });
  await journal.claim({
    agentId,
    sessionId,
    idempotencyKey: conflictKey,
    fingerprint: createRequestFingerprint({ message: 'original' }),
    requestId: 'conflict-owner',
  });

  await expect(
    agent.run({ sessionId, idempotencyKey: activeKey, message: 'active' })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_REPLAY_IN_PROGRESS' })
  );
  await expect(
    agent.run({ sessionId, idempotencyKey: failedKey, message: 'failed' })
  ).rejects.toEqual(
    expect.objectContaining<Partial<RequestReplayFailedError>>({
      code: 'REQUEST_REPLAY_FAILED',
      originalFailure: { code: 'MODEL_FAILED', message: 'original failure' },
    })
  );
  await expect(
    agent.run({ sessionId, idempotencyKey: conflictKey, message: 'different' })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_REPLAY_CONFLICT' })
  );
  expect(agent.inspectDeterministicProvider().callCount).toBe(0);
  expect((await session.inspect({ agentId, sessionId }))?.turns).toHaveLength(0);
  expect(await journal.inspect({ agentId, sessionId, idempotencyKey: activeKey })).toMatchObject({
    status: 'active',
    requestId: 'active-owner',
  });
  expect(
    runIds.map((agentRunId) =>
      trace.inspect({ agentRunId }).events.find((event) => event.type === 'request-replay-resolved')
    )
  ).toMatchObject([{ status: 'active' }, { status: 'failed' }, { status: 'conflict' }]);
});
