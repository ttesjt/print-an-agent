import { createRequestFingerprint, parseRequestIdempotencyKey } from '@print-an-agent/base-request';
import { parseSessionBranchId, parseTurnId } from '@print-an-agent/base-session';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  createMemorySessionPersistence,
  createSqliteSessionPersistence,
} from '../../../src/index.js';
import { agentId, fixture } from '../../support/session/lifecycle-fixture.js';
import { assistantMessage, userMessage } from '../../support/session/messages.js';

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
