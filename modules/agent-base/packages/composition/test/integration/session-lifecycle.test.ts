import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryOutputSink,
  createMemorySessionPersistence,
  createSqliteSessionPersistence,
} from '@ta-agent/base-local-adapters';
import { describe, expect, it, vi } from 'vitest';
import { FOREGROUND_AGENT_OPERATION_NAME, createDeterministicAgentAPI } from '../../src/index.js';
import { createDefaultSessionNavigationStepOverrides } from '@ta-agent/base-session';
import { parseRequestIdempotencyKey } from '@ta-agent/base-request';
import { interactionAgent, interactionMessage } from '../support/interaction-agent.js';

describe.each(['memory', 'sqlite'] as const)('%s runtime lifecycle', (kind) => {
  it.each(['normal', 'replay'] as const)(
    'holds occupancy through %s OutputSink close',
    async (mode) => {
      const directory = mkdtempSync(join(tmpdir(), 'runtime-lifecycle-'));
      try {
        const persistence =
          kind === 'memory'
            ? createMemorySessionPersistence({ createSessionId: () => 'session' })
            : createSqliteSessionPersistence({ databasePath: join(directory, 'agent.sqlite') });
        const engine = vi.fn(
          async (request: Parameters<Parameters<typeof interactionAgent>[0]>[0]) => {
            const message = interactionMessage();
            await request.emit({ type: 'assistant-complete', message });
            return { message };
          }
        );
        const fixture = await interactionAgent(engine, {
          session: persistence.session,
          requestJournal: persistence.requestJournal,
        });
        const page = await persistence.session.listSessions({ agentId: fixture.agent.identity.id });
        const summary = page.records[0];
        if (summary === undefined) throw new Error('Missing Session');
        const ref = { agentId: summary.agentId, sessionId: summary.sessionId };
        if (mode === 'replay') await fixture.run();
        const sink = new MemoryOutputSink();
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const close = sink.close.bind(sink);
        vi.spyOn(sink, 'close').mockImplementation(async (response) => {
          entered.resolve();
          await release.promise;
          await close(response);
        });
        const running = fixture.agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, {
          message: 'start',
          sessionId: ref.sessionId,
          idempotencyKey: 'request',
          outputSink: sink,
        });
        try {
          await entered.promise;
          expect((await persistence.session.inspectSession(ref))?.execution).toMatchObject({
            activeLeaseCount: 1,
            pendingWorkCount: 0,
          });
          await expect(
            persistence.session.retireSession({ ...ref, expectedRevision: 0 })
          ).rejects.toMatchObject({ code: 'SESSION_BUSY' });
        } finally {
          release.resolve();
        }
        await running;
        expect(engine).toHaveBeenCalledTimes(1);
        expect((await persistence.session.inspectSession(ref))?.execution.activeLeaseCount).toBe(0);
        const journalRef = { ...ref, idempotencyKey: parseRequestIdempotencyKey('request') };
        const completed = await persistence.requestJournal.inspect(journalRef);
        const inspection = await persistence.session.inspectSession(ref);
        if (inspection === undefined) throw new Error('Missing Session');
        await persistence.maintenance.recoverSessionPersistence({
          ...ref,
          expectedExecutionRevision: inspection.execution.revision,
        });
        expect(await persistence.requestJournal.inspect(journalRef)).toEqual(completed);
        await persistence.session.retireSession({ ...ref, expectedRevision: 0 });
        await expect(
          fixture.agent.invoke(FOREGROUND_AGENT_OPERATION_NAME, {
            message: 'start',
            sessionId: ref.sessionId,
            idempotencyKey: 'request',
            outputSink: new MemoryOutputSink(),
          })
        ).rejects.toMatchObject({ code: 'SESSION_RETIRED' });
        expect(engine).toHaveBeenCalledTimes(1);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
});

it('holds a lease through failed output cleanup until explicit recovery', async () => {
  const fixture = await interactionAgent(() => Promise.reject(new Error('provider failed')));
  vi.spyOn(fixture.output, 'fail').mockRejectedValue(new Error('sink cleanup failed'));
  await expect(fixture.run()).rejects.toBeDefined();
  const summary = (await fixture.session.listSessions({ agentId: fixture.agent.identity.id }))
    .records[0];
  if (summary === undefined) throw new Error('Missing Session');
  const ref = { agentId: summary.agentId, sessionId: summary.sessionId };
  const inspection = await fixture.session.inspectSession(ref);
  if (inspection === undefined) throw new Error('Missing inspection');
  expect(inspection.execution).toMatchObject({ activeLeaseCount: 1, pendingWorkCount: 0 });
  await expect(
    fixture.session.retireSession({ ...ref, expectedRevision: 0 })
  ).rejects.toMatchObject({ code: 'SESSION_BUSY' });
  await fixture.session.recoverSessionExecutions({
    ...ref,
    expectedExecutionRevision: inspection.execution.revision,
  });
  await fixture.session.retireSession({ ...ref, expectedRevision: 0 });
});

it('settles ordinary failure/cancellation and releases request ownership', async () => {
  const controller = new AbortController();
  const reason = new DOMException('cancelled', 'AbortError');
  const fixture = await interactionAgent(() => {
    controller.abort(reason);
    return Promise.reject(reason);
  });
  await expect(fixture.run(controller.signal)).rejects.toBeDefined();
  const summary = (await fixture.session.listSessions({ agentId: fixture.agent.identity.id }))
    .records[0];
  if (summary === undefined) throw new Error('Missing Session');
  const ref = { agentId: summary.agentId, sessionId: summary.sessionId };
  expect((await fixture.session.inspectSession(ref))?.execution).toMatchObject({
    activeLeaseCount: 0,
    pendingWorkCount: 0,
  });
  await fixture.session.retireSession({ ...ref, expectedRevision: 0 });
});

it.each(['compaction', 'navigation'] as const)(
  'fences %s and revokes suspended writes on explicit recovery',
  async (operation) => {
    const persistence = createMemorySessionPersistence();
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const commit = createDefaultSessionNavigationStepOverrides().commitSessionNavigation;
    if (typeof commit !== 'function') throw new Error('Expected navigation Step');
    let sequence = 0;
    const api = createDeterministicAgentAPI({
      identity: { id: 'maintenance-owner' },
      session: persistence.session,
      requestJournal: persistence.requestJournal,
      createRunId: () => `maintenance-${++sequence}`,
      provider: {
        responses: Array.from({ length: 4 }, () => ({
          status: 'success' as const,
          text: 'answer',
        })),
      },
      sessionCompactionStepOverrides: {
        buildCompactedContext: async (context) => {
          entered.resolve();
          await resume.promise;
          context.compactedContext = { role: 'context', text: 'summary', timestamp: 1 };
        },
      },
      sessionNavigationStepOverrides: {
        commitSessionNavigation: async (context) => {
          if (context.command?.operation !== 'inspect') {
            entered.resolve();
            await resume.promise;
          }
          await commit(context);
        },
      },
    });
    const resolved = await persistence.session.resolve({ agentId: api.identity.id });
    const ref = { agentId: api.identity.id, sessionId: resolved.sessionId };
    for (let i = 0; i < 4; i++) await api.run({ sessionId: ref.sessionId, message: 'question' });
    const before = await persistence.session.inspectSession(ref);
    await api.navigateSession({ sessionId: ref.sessionId, operation: 'inspect' });
    expect((await persistence.session.inspectSession(ref))?.execution.revision).toBe(
      before?.execution.revision
    );
    const running =
      operation === 'compaction'
        ? api.compactSession({ sessionId: ref.sessionId })
        : api.navigateSession({
            sessionId: ref.sessionId,
            operation: 'select',
            branchId: resolved.branchId,
            expectedRevision: 4,
          });
    const rejected = expect(running).rejects.toBeDefined();
    try {
      await entered.promise;
      await expect(
        persistence.session.retireSession({ ...ref, expectedRevision: 0 })
      ).rejects.toMatchObject({ code: 'SESSION_BUSY' });
      const inspection = await persistence.session.inspectSession(ref);
      if (inspection === undefined) throw new Error('Missing Session');
      await persistence.maintenance.recoverSessionPersistence({
        ...ref,
        expectedExecutionRevision: inspection.execution.revision,
      });
    } finally {
      resume.resolve();
    }
    await rejected;
    expect((await persistence.session.inspect(ref))?.navigation.revision).toBe(4);
    expect(
      await persistence.session.readCompaction({ ...ref, branchId: resolved.branchId })
    ).toBeUndefined();
    await persistence.session.retireSession({ ...ref, expectedRevision: 0 });
  }
);
