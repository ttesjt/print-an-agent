import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseAgentId } from '@print-an-agent/base-identity';
import { parseTurnId, parseSessionBranchId } from '@print-an-agent/base-session';
import { createRequestFingerprint, parseRequestIdempotencyKey } from '@print-an-agent/base-request';
import { describe, expect, it } from 'vitest';
import {
  MemorySessionAdapter,
  SqliteSessionAdapter,
  createMemorySessionPersistence,
  createSqliteSessionPersistence,
} from '../../src/index.js';
import { userMessage, assistantMessage } from '../support/session-port-contract.js';

const agentId = parseAgentId('lifecycle-owner');

function fixture(kind: 'memory' | 'sqlite', clock: () => number = () => 100) {
  const directory = mkdtempSync(join(tmpdir(), 'session-lifecycle-'));
  const databasePath = join(directory, 'agent.sqlite');
  const adapter =
    kind === 'memory'
      ? new MemorySessionAdapter({ clock })
      : new SqliteSessionAdapter({ databasePath, clock });
  return {
    adapter,
    databasePath,
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

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

describe.each(['memory', 'sqlite'] as const)('%s coordinated persistence', (kind) => {
  it('retains its fence when Journal recovery fails after Session reconciliation', async () => {
    const h = fixture(kind);
    let remaining = Number.POSITIVE_INFINITY;
    const clock = () => {
      if (--remaining === 0) throw new Error('Journal clock unavailable');
      return 100;
    };
    try {
      const profile =
        kind === 'memory'
          ? createMemorySessionPersistence({ clock })
          : createSqliteSessionPersistence({ databasePath: h.databasePath, clock });
      const resolved = await profile.session.resolve({ agentId });
      const ref = { agentId, sessionId: resolved.sessionId };
      const execution = await profile.session.acquireSessionExecution(ref);
      const journalRef = { ...ref, idempotencyKey: parseRequestIdempotencyKey('unfinished') };
      await profile.requestJournal.claim({
        ...journalRef,
        execution,
        requestId: 'unfinished',
        fingerprint: createRequestFingerprint({ message: 'q' }),
      });
      const before = await profile.session.inspectSession(ref);
      if (before === undefined) throw new Error('Missing Session');
      remaining = 2;
      await expect(
        profile.maintenance.recoverSessionPersistence({
          ...ref,
          expectedExecutionRevision: before.execution.revision,
        })
      ).rejects.toMatchObject({ code: 'SESSION_RECOVERY_FAILED' });
      const failed = await profile.session.inspectSession(ref);
      if (failed === undefined) throw new Error('Missing Session');
      expect(failed.execution).toMatchObject({ state: 'recovering', activeLeaseCount: 0 });
      await expect(
        profile.session.retireSession({ ...ref, expectedRevision: 0 })
      ).rejects.toMatchObject({ code: 'SESSION_BUSY' });
      remaining = Number.POSITIVE_INFINITY;
      await profile.maintenance.recoverSessionPersistence({
        ...ref,
        expectedExecutionRevision: failed.execution.revision,
      });
      expect(await profile.requestJournal.inspect(journalRef)).toMatchObject({ status: 'failed' });
      await expect(profile.session.releaseSessionExecution(execution)).rejects.toMatchObject({
        code: 'SESSION_EXECUTION_STALE',
      });
      await profile.session.retireSession({ ...ref, expectedRevision: 0 });
    } finally {
      h.dispose();
    }
  });

  it('fences Journal writes, preserves completed Session turns during recovery, and purges both domains', async () => {
    const h = fixture(kind);
    try {
      const profile =
        kind === 'memory'
          ? createMemorySessionPersistence()
          : createSqliteSessionPersistence({ databasePath: h.databasePath });
      const resolved = await profile.session.resolve({ agentId });
      const ref = { agentId, sessionId: resolved.sessionId };
      const execution = await profile.session.acquireSessionExecution(ref);
      const turnId = parseTurnId('finished');
      await profile.session.beginTurn({
        ...resolved,
        execution,
        turnId,
        userMessage: userMessage('q', 1),
      });
      await profile.session.completeTurnWithPresentation({
        ...ref,
        execution,
        turnId,
        assistantMessage: assistantMessage('saved', 2),
        presentation: { reasoningBlocks: [{ modelTurnIndex: 1, text: 'visible reasoning' }] },
      });
      await profile.session.commitCompaction({
        ...ref,
        execution,
        branchId: resolved.branchId,
        expectedRevision: 0,
        throughTurnId: turnId,
        context: { role: 'context', text: 'summary', timestamp: 3 },
      });
      await profile.session.applyNavigation({
        ...ref,
        execution,
        command: {
          operation: 'fork',
          sourceBranchId: resolved.branchId,
          throughTurnId: turnId,
          newBranchId: parseSessionBranchId('child'),
          expectedRevision: 1,
        },
      });
      const journalRef = { ...ref, idempotencyKey: parseRequestIdempotencyKey('retry') };
      const claim = {
        ...journalRef,
        requestId: 'request',
        fingerprint: createRequestFingerprint({ message: 'q' }),
      };
      await profile.requestJournal.claim({ ...claim, execution });
      const before = await profile.session.inspectSession(ref);
      if (before === undefined) throw new Error('Missing Session');
      await profile.maintenance.recoverSessionPersistence({
        ...ref,
        expectedExecutionRevision: before.execution.revision,
      });
      expect((await profile.session.inspect(ref))?.turns[0]?.status).toBe('completed');
      expect(await profile.requestJournal.inspect(journalRef)).toMatchObject({
        status: 'failed',
        failure: { code: 'REQUEST_EXECUTION_INTERRUPTED' },
      });
      await expect(profile.requestJournal.claim({ ...claim, execution })).rejects.toMatchObject({
        code: 'SESSION_EXECUTION_STALE',
      });
      const unrelated = await profile.session.resolve({ agentId });
      await profile.session.retireSession({ ...ref, expectedRevision: 0 });
      await profile.maintenance.purgeSessionPersistence({
        ...ref,
        expectedRevision: 1,
        confirmation: 'permanently-delete-session',
      });
      expect(await profile.session.inspect(ref)).toBeUndefined();
      expect(await profile.requestJournal.inspect(journalRef)).toBeUndefined();
      expect(await profile.session.readTurnPresentation({ ...ref, turnId })).toBeUndefined();
      expect(await profile.session.inspect(unrelated)).toBeDefined();
      if (kind === 'sqlite') {
        const db = new DatabaseSync(h.databasePath);
        try {
          for (const table of [
            'agent_session_turns',
            'agent_session_branches',
            'agent_session_compactions',
            'agent_request_journal_entries',
          ]) {
            expect(
              db
                .prepare(`SELECT count(*) AS count FROM ${table} WHERE session_id = ?`)
                .get(ref.sessionId)
            ).toMatchObject({ count: 0 });
          }
          expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        } finally {
          db.close();
        }
      }
    } finally {
      h.dispose();
    }
  });
});

it('keeps SQLite recovery fenced when Journal reconciliation fails and permits an explicit retry', async () => {
  const h = fixture('sqlite');
  try {
    const profile = createSqliteSessionPersistence({ databasePath: h.databasePath });
    const resolved = await profile.session.resolve({ agentId });
    const ref = { agentId, sessionId: resolved.sessionId };
    const execution = await profile.session.acquireSessionExecution(ref);
    const turnId = parseTurnId('pending');
    await profile.session.beginTurn({
      ...resolved,
      execution,
      turnId,
      userMessage: userMessage('q', 1),
    });
    const claim = {
      ...ref,
      idempotencyKey: parseRequestIdempotencyKey('interrupted'),
      requestId: 'interrupted',
      execution,
      fingerprint: createRequestFingerprint({ message: 'q' }),
    };
    await profile.requestJournal.claim(claim);
    const before = await profile.session.inspectSession(ref);
    if (before === undefined) throw new Error('Missing Session');
    const db = new DatabaseSync(h.databasePath);
    try {
      db.exec(
        "CREATE TRIGGER reject_recovery BEFORE UPDATE ON agent_request_journal_entries BEGIN SELECT RAISE(ABORT, 'injected'); END;"
      );
    } finally {
      db.close();
    }
    await expect(
      profile.maintenance.recoverSessionPersistence({
        ...ref,
        expectedExecutionRevision: before.execution.revision,
      })
    ).rejects.toMatchObject({ code: 'SESSION_RECOVERY_FAILED' });
    const reopened = createSqliteSessionPersistence({ databasePath: h.databasePath });
    const failed = await reopened.session.inspectSession(ref);
    if (failed === undefined) throw new Error('Missing Session');
    expect(failed.execution).toMatchObject({
      state: 'recovering',
      activeLeaseCount: 0,
      pendingWorkCount: 1,
    });
    await expect(reopened.session.acquireSessionExecution(ref)).rejects.toMatchObject({
      code: 'SESSION_BUSY',
    });
    await expect(profile.requestJournal.claim(claim)).rejects.toMatchObject({
      code: 'SESSION_BUSY',
    });
    const repair = new DatabaseSync(h.databasePath);
    try {
      repair.exec('DROP TRIGGER reject_recovery');
    } finally {
      repair.close();
    }
    await reopened.maintenance.recoverSessionPersistence({
      ...ref,
      expectedExecutionRevision: failed.execution.revision,
    });
    await expect(profile.requestJournal.claim(claim)).rejects.toMatchObject({
      code: 'SESSION_EXECUTION_STALE',
    });
    expect((await reopened.session.inspect(ref))?.turns[0]).toMatchObject({ status: 'failed' });
    await reopened.session.retireSession({ ...ref, expectedRevision: 0 });
  } finally {
    h.dispose();
  }
});

it('persists occupancy across SQLite connections and rolls back failed coordinated deletion', async () => {
  const h = fixture('sqlite');
  try {
    const profile = createSqliteSessionPersistence({ databasePath: h.databasePath });
    const resolved = await profile.session.resolve({ agentId });
    const ref = { agentId, sessionId: resolved.sessionId };
    const execution = await profile.session.acquireSessionExecution(ref);
    const reopened = createSqliteSessionPersistence({ databasePath: h.databasePath });
    await expect(
      reopened.session.retireSession({ ...ref, expectedRevision: 0 })
    ).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    const journalRef = { ...ref, idempotencyKey: parseRequestIdempotencyKey('entry') };
    await profile.requestJournal.claim({
      ...journalRef,
      requestId: 'request',
      execution,
      fingerprint: createRequestFingerprint({ message: 'q' }),
    });
    const before = await reopened.session.inspectSession(ref);
    if (before === undefined) throw new Error('Missing Session');
    await reopened.maintenance.recoverSessionPersistence({
      ...ref,
      expectedExecutionRevision: before.execution.revision,
    });
    await reopened.session.retireSession({ ...ref, expectedRevision: 0 });
    const db = new DatabaseSync(h.databasePath);
    try {
      db.exec(
        "CREATE TRIGGER reject_purge BEFORE DELETE ON agent_sessions BEGIN SELECT RAISE(ABORT, 'injected'); END;"
      );
    } finally {
      db.close();
    }
    await expect(
      reopened.maintenance.purgeSessionPersistence({
        ...ref,
        expectedRevision: 1,
        confirmation: 'permanently-delete-session',
      })
    ).rejects.toMatchObject({ code: 'SESSION_PURGE_FAILED' });
    expect(await reopened.session.inspect(ref)).toBeDefined();
    expect(await reopened.requestJournal.inspect(journalRef)).toBeDefined();
  } finally {
    h.dispose();
  }
});

it('requires both SQLite schemas in existing mode without initializing missing tables', () => {
  const h = fixture('sqlite');
  try {
    expect(() =>
      createSqliteSessionPersistence({ databasePath: h.databasePath, schemaMode: 'existing' })
    ).toThrowError();
    const database = new DatabaseSync(h.databasePath);
    try {
      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get('agent_request_journal_schema')
      ).toBeUndefined();
    } finally {
      database.close();
    }
    createSqliteSessionPersistence({ databasePath: h.databasePath });
    expect(() =>
      createSqliteSessionPersistence({ databasePath: h.databasePath, schemaMode: 'existing' })
    ).not.toThrow();
  } finally {
    h.dispose();
  }
});
