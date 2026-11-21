import { parseTurnId } from '@print-an-agent/base-session';
import { describe, expect, it } from 'vitest';
import { agentId, fixture } from '../../support/session/lifecycle-fixture.js';
import { assistantMessage, userMessage } from '../../support/session/messages.js';

describe.each(['memory', 'sqlite'] as const)('%s lifecycle qualification', (kind) => {
  it('retires, queries bounded summaries/history, restores identity, and purges only retired Sessions', async () => {
    const h = fixture(kind);
    try {
      const resolved = await h.adapter.resolve({ agentId });
      const ref = { agentId, sessionId: resolved.sessionId };
      const execution = await h.adapter.acquireSessionExecution(ref);
      const turnId = parseTurnId('turn');
      await h.adapter.beginTurn({
        ...resolved,
        execution,
        turnId,
        userMessage: userMessage('question', 1),
      });
      await h.adapter.completeTurn({
        ...ref,
        execution,
        turnId,
        assistantMessage: assistantMessage('answer', 2),
      });
      await h.adapter.releaseSessionExecution(execution);
      await expect(
        h.adapter.purgeSession({
          ...ref,
          expectedRevision: 0,
          confirmation: 'permanently-delete-session',
        })
      ).rejects.toMatchObject({ code: 'SESSION_NOT_RETIRED' });
      await h.adapter.retireSession({ ...ref, expectedRevision: 0 });
      expect((await h.adapter.listSessions({ agentId })).records).toHaveLength(0);
      const retired = await h.adapter.listRetiredSessions({ agentId, limit: 1 });
      expect(retired.records[0]).toMatchObject({ ...ref, status: 'retired', retiredAt: 100 });
      expect(retired.records[0]).not.toHaveProperty('execution');
      expect((await h.adapter.inspect(ref))?.turns).toHaveLength(1);
      await expect(h.adapter.resolve(ref)).rejects.toMatchObject({ code: 'SESSION_RETIRED' });
      await expect(h.adapter.acquireSessionExecution(ref)).rejects.toMatchObject({
        code: 'SESSION_RETIRED',
      });
      await h.adapter.renameSession({ ...ref, expectedRevision: 1, title: 'readable' });
      await expect(h.adapter.restoreSession({ ...ref, expectedRevision: 1 })).rejects.toMatchObject(
        { code: 'SESSION_METADATA_CONFLICT' }
      );
      await h.adapter.restoreSession({ ...ref, expectedRevision: 2 });
      expect((await h.adapter.resolve(ref)).sessionId).toBe(ref.sessionId);
      await expect(
        h.adapter.completeTurn({
          ...ref,
          execution,
          turnId,
          assistantMessage: assistantMessage('late', 3),
        })
      ).rejects.toMatchObject({ code: 'SESSION_EXECUTION_STALE' });
      await h.adapter.retireSession({ ...ref, expectedRevision: 3 });
      await h.adapter.purgeSession({
        ...ref,
        expectedRevision: 4,
        confirmation: 'permanently-delete-session',
      });
      expect(await h.adapter.inspectSession(ref)).toBeUndefined();
      expect((await h.adapter.resolve({ agentId })).sessionId).not.toBe(ref.sessionId);
      await expect(h.adapter.resolve(ref)).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    } finally {
      h.dispose();
    }
  });

  it('serializes admission against retirement and rejects writes without or with foreign authority', async () => {
    const h = fixture(kind);
    try {
      const resolved = await h.adapter.resolve({ agentId });
      const ref = { agentId, sessionId: resolved.sessionId };
      const [admission, retirement] = await Promise.allSettled([
        h.adapter.acquireSessionExecution(ref),
        h.adapter.retireSession({ ...ref, expectedRevision: 0 }),
      ]);
      expect(admission.status).toBe('fulfilled');
      expect(retirement).toMatchObject({ status: 'rejected', reason: { code: 'SESSION_BUSY' } });
      if (admission.status !== 'fulfilled') throw new Error('Missing lease');
      await expect(
        h.adapter.beginTurn({
          ...resolved,
          turnId: parseTurnId('missing'),
          userMessage: userMessage('q', 1),
        })
      ).rejects.toMatchObject({ code: 'SESSION_EXECUTION_STALE' });
      const another = await h.adapter.resolve({ agentId });
      await expect(
        h.adapter.beginTurn({
          ...another,
          execution: admission.value,
          turnId: parseTurnId('foreign'),
          userMessage: userMessage('q', 1),
        })
      ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
      await h.adapter.releaseSessionExecution(admission.value);
      const [retired, denied] = await Promise.allSettled([
        h.adapter.retireSession({ ...ref, expectedRevision: 0 }),
        h.adapter.acquireSessionExecution(ref),
      ]);
      expect(retired.status).toBe('fulfilled');
      expect(denied).toMatchObject({ status: 'rejected', reason: { code: 'SESSION_RETIRED' } });
    } finally {
      h.dispose();
    }
  });

  it('retains busy for unsettled Turns after lease release and explicitly recovers stale credentials', async () => {
    const h = fixture(kind);
    try {
      const resolved = await h.adapter.resolve({ agentId });
      const ref = { agentId, sessionId: resolved.sessionId };
      const execution = await h.adapter.acquireSessionExecution(ref);
      const turnId = parseTurnId('interrupted');
      await h.adapter.beginTurn({
        ...resolved,
        execution,
        turnId,
        userMessage: userMessage('q', 1),
      });
      await h.adapter.releaseSessionExecution(execution);
      await expect(h.adapter.retireSession({ ...ref, expectedRevision: 0 })).rejects.toMatchObject({
        code: 'SESSION_BUSY',
      });
      const inspection = await h.adapter.inspectSession(ref);
      if (inspection === undefined) throw new Error('Missing Session');
      await expect(
        h.adapter.recoverSessionExecutions({ ...ref, expectedExecutionRevision: 0 })
      ).rejects.toMatchObject({ code: 'SESSION_EXECUTION_CONFLICT' });
      const recovered = await h.adapter.recoverSessionExecutions({
        ...ref,
        expectedExecutionRevision: inspection.execution.revision,
      });
      expect(recovered).toMatchObject({ state: 'ready', activeLeaseCount: 0, pendingWorkCount: 0 });
      expect((await h.adapter.inspect(ref))?.turns[0]).toMatchObject({
        status: 'failed',
        failureCode: 'SESSION_EXECUTION_INTERRUPTED',
      });
      await expect(
        h.adapter.failTurn({ ...ref, execution, turnId, failureCode: 'LATE' })
      ).rejects.toMatchObject({ code: 'SESSION_EXECUTION_STALE' });
      await h.adapter.retireSession({ ...ref, expectedRevision: 0 });
    } finally {
      h.dispose();
    }
  });

  it('leaves failed recovery fenced and permits an explicit retry with fresh evidence', async () => {
    let broken = false;
    const h = fixture(kind, () => {
      if (broken) throw new Error('clock failure');
      return 100;
    });
    try {
      const resolved = await h.adapter.resolve({ agentId });
      const ref = { agentId, sessionId: resolved.sessionId };
      const execution = await h.adapter.acquireSessionExecution(ref);
      const inspection = await h.adapter.inspectSession(ref);
      if (inspection === undefined) throw new Error('Missing Session');
      broken = true;
      await expect(
        h.adapter.recoverSessionExecutions({
          ...ref,
          expectedExecutionRevision: inspection.execution.revision,
        })
      ).rejects.toMatchObject({ code: 'SESSION_RECOVERY_FAILED' });
      const failed = await h.adapter.inspectSession(ref);
      expect(failed?.execution).toMatchObject({ state: 'recovering', activeLeaseCount: 0 });
      await expect(h.adapter.acquireSessionExecution(ref)).rejects.toMatchObject({
        code: 'SESSION_BUSY',
      });
      broken = false;
      if (failed === undefined) throw new Error('Missing Session');
      await h.adapter.recoverSessionExecutions({
        ...ref,
        expectedExecutionRevision: failed.execution.revision,
      });
      await expect(h.adapter.releaseSessionExecution(execution)).rejects.toMatchObject({
        code: 'SESSION_EXECUTION_STALE',
      });
    } finally {
      h.dispose();
    }
  });

  it('paginates retired records independently from activity and excludes occupancy from lists', async () => {
    const h = fixture(kind);
    try {
      const sessions = await Promise.all(
        Array.from({ length: 3 }, () => h.adapter.resolve({ agentId }))
      );
      for (const session of sessions)
        await h.adapter.retireSession({
          agentId,
          sessionId: session.sessionId,
          expectedRevision: 0,
        });
      const first = await h.adapter.listRetiredSessions({ agentId, limit: 2 });
      if (first.nextCursor === undefined) throw new Error('Missing next cursor');
      const second = await h.adapter.listRetiredSessions({
        agentId,
        limit: 2,
        cursor: first.nextCursor,
      });
      expect([...first.records, ...second.records].map((s) => s.sessionId)).toEqual(
        sessions.map((s) => s.sessionId).sort()
      );
      expect(second.nextCursor).toBeUndefined();
    } finally {
      h.dispose();
    }
  });
});
