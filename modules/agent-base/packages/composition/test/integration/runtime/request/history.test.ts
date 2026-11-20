import {
  MemoryAgentTraceAdapter,
  MemoryOutputSink,
  MemorySessionAdapter,
  SqliteSessionAdapter,
} from '@print-an-agent/base-local-adapters';
import { parseSessionId } from '@print-an-agent/base-session';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';
import { LifecycleRecordingOutputSink } from '../../../support/runtime/output-sinks.js';

it('streams one response and supplies completed history to a second Pi request', async () => {
  const session = new MemorySessionAdapter();
  const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
  const runIds = ['history-first-run', 'history-second-run'];
  let runIndex = 0;
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant', displayName: 'Assistant' },
    createRunId: () => runIds[runIndex++] ?? 'unexpected-history-run',
    session,
    observability: { sink: trace, clock: () => 1 },
    provider: {
      responses: [
        { status: 'success', text: 'Hello Wei.' },
        (request) => ({
          status: 'success',
          text: `history:${request.messages.map((message) => message.role).join(',')}`,
        }),
      ],
      charactersPerChunk: 3,
    },
    clock: (() => {
      let now = 0;
      return () => ++now;
    })(),
  });
  const { sessionId } = await agent.agent.resources.session.resolve({
    agentId: agent.identity.id,
  });
  const firstSink = new LifecycleRecordingOutputSink();
  const first = await agent.run({
    sessionId: sessionId,
    message: 'My name is Wei.',
    outputSink: firstSink,
  });
  const secondSink = new MemoryOutputSink();
  const second = await agent.run({
    sessionId: first.sessionId,
    message: 'What is my name?',
    outputSink: secondSink,
  });

  expect(first.message.text).toBe('Hello Wei.');
  expect(
    firstSink
      .inspect()
      .events.map((event) => event.delta)
      .join('')
  ).toBe('Hello Wei.');
  expect(firstSink.calls.at(0)).toBe('open');
  expect(firstSink.calls.at(-1)).toBe('close');
  expect(second.message.text).toBe('history:user,assistant,user');
  expect(
    agent.inspectDeterministicProvider().requests[1]?.messages.map((message) => message.role)
  ).toEqual(['user', 'assistant', 'user']);
  const snapshot = await session.inspect({
    agentId: agent.identity.id,
    sessionId: parseSessionId(sessionId),
  });
  expect(snapshot?.turns.map((turn) => turn.status)).toEqual(['completed', 'completed']);
  const serializedSecondTrace = JSON.stringify(
    trace.inspect({ agentRunId: 'history-second-run' }).events
  );
  for (const privateText of [
    'My name is Wei.',
    'Hello Wei.',
    'What is my name?',
    'history:user,assistant,user',
  ]) {
    expect(serializedSecondTrace).not.toContain(privateText);
  }
});

it('restarts with a new assembled Agent and continues durable Session history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ta-agent-assembled-session-'));
  const databasePath = join(directory, 'session.sqlite');
  try {
    const firstSession = new SqliteSessionAdapter({ databasePath });
    const firstAgent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'durable-assistant' },
      session: firstSession,
      provider: { responses: [{ status: 'success', text: 'Remembered.' }] },
    });
    const { sessionId } = await firstAgent.agent.resources.session.resolve({
      agentId: firstAgent.identity.id,
    });
    const first = await firstAgent.run({
      sessionId: sessionId,
      message: 'Remember this.',
    });

    const reopenedSession = new SqliteSessionAdapter({ databasePath });
    const reopenedAgent = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'durable-assistant' },
      session: reopenedSession,
      provider: {
        responses: [
          (request) => ({
            status: 'success',
            text: `history:${request.messages.map((message) => message.role).join(',')}`,
          }),
        ],
      },
    });
    const second = await reopenedAgent.run({
      sessionId: first.sessionId,
      message: 'What did I ask?',
    });

    expect(second.message.text).toBe('history:user,assistant,user');
    const snapshot = await reopenedSession.inspect({
      agentId: reopenedAgent.identity.id,
      sessionId: parseSessionId(sessionId),
    });
    expect(snapshot?.turns.map((turn) => turn.status)).toEqual(['completed', 'completed']);
    const independentlyReopened = new SqliteSessionAdapter({ databasePath });
    expect(
      (
        await independentlyReopened.inspect({
          agentId: reopenedAgent.identity.id,
          sessionId: parseSessionId(sessionId),
        })
      )?.turns.map((turn) => turn.status)
    ).toEqual(['completed', 'completed']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
