import { MemorySessionAdapter } from '@ta-agent/base-local-adapters';
import type { CompactableSessionPort, SessionExecutionPort } from '@ta-agent/base-session';
import { SKIP_STEP } from '@ta-agent/workflow-core';
import { expect, it } from 'vitest';
import { createDeterministicAgentAPI } from '../../src/index.js';

it('runs foreground and compaction with a Session port that cannot apply navigation', async () => {
  const storage = new MemorySessionAdapter();
  const session: CompactableSessionPort & SessionExecutionPort = Object.freeze({
    resolve: storage.resolve.bind(storage),
    beginTurn: storage.beginTurn.bind(storage),
    loadHistory: storage.loadHistory.bind(storage),
    loadContext: storage.loadContext.bind(storage),
    completeTurn: storage.completeTurn.bind(storage),
    failTurn: storage.failTurn.bind(storage),
    inspect: storage.inspect.bind(storage),
    readCompaction: storage.readCompaction.bind(storage),
    commitCompaction: storage.commitCompaction.bind(storage),
    acquireSessionExecution: storage.acquireSessionExecution.bind(storage),
    releaseSessionExecution: storage.releaseSessionExecution.bind(storage),
  });
  let requestSequence = 0;
  const api = createDeterministicAgentAPI({
    identity: { id: 'runtime-session-owner' },
    session,
    stepOverrides: { captureReasoningPresentation: SKIP_STEP },
    createRunId: () => `runtime-request-${++requestSequence}`,
    provider: {
      responses: [
        { status: 'success', text: 'one' },
        { status: 'success', text: 'two' },
        { status: 'success', text: 'three' },
        { status: 'success', text: 'four' },
        { status: 'success', text: 'compacted context' },
      ],
    },
  });
  const reference = await session.resolve({ agentId: api.identity.id });

  expect(api.agent.resources.session).toBe(session);
  expect(session).not.toHaveProperty('applyNavigation');
  for (const message of ['one', 'two', 'three', 'four']) {
    await expect(api.run({ sessionId: reference.sessionId, message })).resolves.toMatchObject({
      message: { text: message },
    });
  }
  await expect(api.compactSession({ sessionId: reference.sessionId })).resolves.toMatchObject({
    status: 'compacted',
    compactedTurnCount: 2,
  });
  await expect(session.readCompaction(reference)).resolves.toMatchObject({
    context: { text: 'compacted context' },
  });
  expect((await session.inspect(reference))?.turns).toHaveLength(4);
});
