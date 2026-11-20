import { MemoryAgentTraceAdapter, SqliteSessionAdapter } from '@print-an-agent/base-local-adapters';
import { parseSessionId } from '@print-an-agent/base-session';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { TEST_COMPACTION_TOKEN_COUNTER } from '../../../support/runtime/compaction-token-counter.js';

it('compacts a durable Session through Pi and reuses projection plus tail after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ta-agent-compaction-'));
  const databasePath = join(directory, 'session.sqlite');
  const trace = new MemoryAgentTraceAdapter({ maxEvents: 256 });
  let requestSequence = 0;
  try {
    const first = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'assistant' },
      session: new SqliteSessionAdapter({ databasePath, clock: () => 10 }),
      createRunId: () => `request-${++requestSequence}`,
      createCompactionRunId: () => 'compaction-run',
      createCompactionWorkflowRunId: () => 'compaction-workflow',
      observability: { sink: trace, clock: () => 20 },
      provider: {
        responses: [
          { status: 'success', text: 'PRIVATE_ANSWER_1' },
          { status: 'success', text: 'PRIVATE_ANSWER_2' },
          { status: 'success', text: 'PRIVATE_ANSWER_3' },
          { status: 'success', text: 'PRIVATE_ANSWER_4' },
          { status: 'success', text: 'PRIVATE_COMPACTED_CONTEXT' },
        ],
      },
    });
    const { sessionId } = await first.agent.resources.session.resolve({
      agentId: first.identity.id,
    });
    for (let index = 1; index <= 4; index += 1) {
      await first.run({ message: `PRIVATE_USER_${index}`, sessionId: sessionId });
    }

    await expect(first.compactSession({ sessionId: sessionId })).resolves.toEqual({
      status: 'compacted',
      sessionId: sessionId,
      branchId: 'main',
      revision: 1,
      throughTurnId: 'request-2',
      compactedTurnCount: 2,
    });
    expect(first.inspectDeterministicProvider().requests.at(-1)).toMatchObject({
      kind: 'direct',
    });

    const reopenedSession = new SqliteSessionAdapter({ databasePath, clock: () => 30 });
    const reopened = createDeterministicAgentAPI({
      sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
      identity: { id: 'assistant' },
      session: reopenedSession,
      createRunId: () => `request-${++requestSequence}`,
      provider: { responses: [{ status: 'success', text: 'PRIVATE_ANSWER_5' }] },
    });
    const requestAfterCompaction = {
      message: 'PRIVATE_USER_5',
      sessionId: sessionId,
      idempotencyKey: 'after-compaction',
    } as const;
    const firstAfterCompaction = await reopened.run(requestAfterCompaction);
    const replayAfterCompaction = await reopened.run(requestAfterCompaction);
    expect(replayAfterCompaction).toEqual(firstAfterCompaction);
    expect(reopened.inspectDeterministicProvider().callCount).toBe(1);

    const providerRequest = reopened.inspectDeterministicProvider().requests[0];
    expect(providerRequest).toMatchObject({ kind: 'agent-loop' });
    const serializedProviderRequest = JSON.stringify(providerRequest);
    expect(serializedProviderRequest).toContain('PRIVATE_COMPACTED_CONTEXT');
    expect(serializedProviderRequest).toContain('PRIVATE_USER_3');
    expect(serializedProviderRequest).toContain('PRIVATE_ANSWER_4');
    expect(serializedProviderRequest).not.toContain('PRIVATE_USER_1');
    expect(serializedProviderRequest).not.toContain('PRIVATE_ANSWER_2');
    expect(
      (
        await reopenedSession.inspect({
          agentId: reopened.identity.id,
          sessionId: parseSessionId(sessionId),
        })
      )?.turns
    ).toHaveLength(5);

    const compactionEvents = trace.inspect({ agentRunId: 'compaction-run' }).events;
    expect(
      compactionEvents.flatMap((event) => (event.type === 'step-started' ? [event.stepName] : []))
    ).toEqual([
      'runSessionCompaction',
      'inspectSession',
      'selectCompactionSource',
      'resolveCompactionTarget',
      'resolveCompactionTokenCounter',
      'resolveCompactionActor',
      'buildCompactedContext',
      'prepareCompactionAttempt',
      'generateCompactionCandidate',
      'measureCompactionCandidate',
      'validateCompactionCandidate',
      'persistCompaction',
    ]);
    const serializedTrace = JSON.stringify(compactionEvents);
    expect(serializedTrace).toContain('compactSession');
    expect(serializedTrace).not.toContain('PRIVATE_USER');
    expect(serializedTrace).not.toContain('PRIVATE_ANSWER');
    expect(serializedTrace).not.toContain('PRIVATE_COMPACTED_CONTEXT');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('skips compaction before policy eligibility without consuming a Pi response', async () => {
  let requestSequence = 0;
  const agent = createDeterministicAgentAPI({
    sessionCompactionTokenCounter: TEST_COMPACTION_TOKEN_COUNTER,
    identity: { id: 'assistant' },
    createRunId: () => `short-${++requestSequence}`,
    provider: {
      responses: [
        { status: 'success', text: 'one' },
        { status: 'success', text: 'two' },
        { status: 'success', text: 'reserved' },
      ],
    },
  });
  const { sessionId } = await agent.agent.resources.session.resolve({
    agentId: agent.identity.id,
  });
  await agent.run({ message: 'one', sessionId: sessionId });
  await agent.run({ message: 'two', sessionId: sessionId });

  await expect(agent.compactSession({ sessionId: sessionId })).resolves.toEqual({
    status: 'skipped',
    sessionId: sessionId,
    branchId: 'main',
    reason: 'not-needed',
  });
  expect(agent.inspectDeterministicProvider()).toMatchObject({
    callCount: 2,
    pendingResponseCount: 1,
  });
});
