import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import {
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionBranchId,
  parseTurnId,
} from '@print-an-agent/base-session';
import { expect, it } from 'vitest';
import { withHarness } from './harness.js';
import { assistantMessage, userMessage } from './messages.js';
import type { SessionPortContractHarness } from './types.js';
import { sessionWrite } from './write.js';

export function defineSessionQueryContract(createHarness: () => SessionPortContractHarness): void {
  it('lists recently active Sessions with stable keyset pagination', () =>
    withHarness(createHarness, async (adapter) => {
      const agentId = defineAgentIdentity({ id: 'query-agent' }).id;
      const older = await adapter.resolve({ agentId });
      const newer = await adapter.resolve({ agentId });
      const turnId = parseTurnId('older-activity');
      await sessionWrite(
        adapter,
        {
          ...older,
          turnId,
          userMessage: userMessage('touch older', 1),
        },
        (input) => adapter.beginTurn(input)
      );

      const first = await adapter.listSessions({ agentId, limit: 1 });
      expect(first.records).toHaveLength(1);
      expect(first.records[0]).toMatchObject({
        agentId,
        sessionId: older.sessionId,
        branchCount: 1,
        turnCount: 1,
      });
      expect(first.nextCursor).toEqual({
        updatedAt: first.records[0]?.updatedAt,
        sessionId: older.sessionId,
      });
      const second = await adapter.listSessions({
        agentId,
        limit: 1,
        ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
      });
      expect(second.records.map((session) => session.sessionId)).toEqual([newer.sessionId]);
      expect(second.nextCursor).toBeUndefined();
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.records)).toBe(true);
      expect(Object.isFrozen(first.records[0])).toBe(true);
      expect(Object.isFrozen(first.nextCursor)).toBe(true);

      await expect(adapter.listSessions({ agentId, limit: 0 })).rejects.toMatchObject({
        code: 'SESSION_QUERY_INVALID',
      });
      await expect(
        adapter.listSessions({
          agentId,
          cursor: { updatedAt: -1, sessionId: older.sessionId },
        })
      ).rejects.toMatchObject({ code: 'SESSION_QUERY_INVALID' });
      await expect(
        adapter.listSessions({ agentId: defineAgentIdentity({ id: 'other-agent' }).id })
      ).resolves.toEqual({ records: [] });
    }));

  it('inspects bounded Session metadata without embedding branch or turn ledgers', () =>
    withHarness(createHarness, async (adapter) => {
      const agentId = defineAgentIdentity({ id: 'inspect-query-agent' }).id;
      const session = await adapter.resolve({ agentId });
      const inspected = await adapter.inspectSession(session);
      expect(inspected).toMatchObject({
        agentId,
        sessionId: session.sessionId,
        selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        navigationRevision: 0,
        branchCount: 1,
        turnCount: 0,
      });
      expect(inspected).not.toHaveProperty('branches');
      expect(inspected).not.toHaveProperty('turns');
      expect(Object.isFrozen(inspected)).toBe(true);
      await expect(
        adapter.inspectSession({ agentId, sessionId: 'missing' as never })
      ).resolves.toBeUndefined();
    }));

  it('renames Session metadata with CAS without changing activity order', () =>
    withHarness(createHarness, async (adapter) => {
      const agentId = defineAgentIdentity({ id: 'metadata-agent' }).id;
      const older = await adapter.resolve({ agentId });
      const newer = await adapter.resolve({ agentId });
      const before = await adapter.inspectSession({
        agentId,
        sessionId: older.sessionId,
      });
      if (before === undefined) throw new Error('Expected Session metadata.');

      const renamed = await adapter.renameSession({
        agentId,
        sessionId: before.sessionId,
        title: '  Research notes  ',
        expectedRevision: before.metadataRevision,
      });
      expect(renamed).toMatchObject({
        title: 'Research notes',
        metadataRevision: before.metadataRevision + 1,
        updatedAt: before.updatedAt,
      });
      expect(renamed.metadataUpdatedAt).toBeGreaterThan(before.metadataUpdatedAt);
      await expect(
        adapter.renameSession({
          agentId,
          sessionId: before.sessionId,
          title: 'Stale rename',
          expectedRevision: before.metadataRevision,
        })
      ).rejects.toMatchObject({ code: 'SESSION_METADATA_CONFLICT' });
      await expect(
        adapter.renameSession({
          agentId,
          sessionId: before.sessionId,
          title: '   ',
          expectedRevision: renamed.metadataRevision,
        })
      ).rejects.toMatchObject({ code: 'SESSION_METADATA_INVALID' });
      await expect(adapter.listSessions({ agentId })).resolves.toMatchObject({
        records: [
          { sessionId: newer.sessionId },
          { sessionId: older.sessionId, title: 'Research notes' },
        ],
      });
    }));

  it('advances recent activity for every Session mutation path', () =>
    withHarness(createHarness, async (adapter) => {
      const agentId = defineAgentIdentity({ id: 'activity-agent' }).id;
      let session = await adapter.resolve({ agentId });
      const readActivity = async (): Promise<number> => {
        const inspection = await adapter.inspectSession(session);
        if (inspection === undefined) throw new Error('Expected the Session to exist.');
        return inspection.updatedAt;
      };
      let previousActivity = await readActivity();
      const expectActivityAdvance = async (): Promise<void> => {
        const currentActivity = await readActivity();
        expect(currentActivity).toBeGreaterThan(previousActivity);
        previousActivity = currentActivity;
      };

      const completedId = parseTurnId('completed-activity');
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: completedId,
          userMessage: userMessage('complete me', 1),
        },
        (input) => adapter.beginTurn(input)
      );
      await expectActivityAdvance();
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: completedId,
          assistantMessage: assistantMessage('completed', 2),
        },
        (input) => adapter.completeTurn(input)
      );
      await expectActivityAdvance();

      session = await adapter.resolve({ agentId, sessionId: session.sessionId });
      await sessionWrite(
        adapter,
        {
          ...session,
          command: {
            operation: 'select',
            branchId: DEFAULT_SESSION_BRANCH_ID,
            expectedRevision: session.navigationRevision,
          },
        },
        (input) => adapter.applyNavigation(input)
      );
      await expectActivityAdvance();
      await sessionWrite(
        adapter,
        {
          ...session,
          expectedRevision: 0,
          throughTurnId: completedId,
          context: { role: 'context', text: 'summary', timestamp: 3 },
        },
        (input) => adapter.commitCompaction(input)
      );
      await expectActivityAdvance();

      session = await adapter.resolve({ agentId, sessionId: session.sessionId });
      const failedId = parseTurnId('failed-activity');
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: failedId,
          userMessage: userMessage('fail me', 4),
        },
        (input) => adapter.beginTurn(input)
      );
      await expectActivityAdvance();
      await sessionWrite(
        adapter,
        { ...session, turnId: failedId, failureCode: 'EXPECTED_FAILURE' },
        (input) => adapter.failTurn(input)
      );
      await expectActivityAdvance();
    }));

  it('pages the lossless newest-first turn ledger across branches and statuses', () =>
    withHarness(createHarness, async (adapter) => {
      const agentId = defineAgentIdentity({ id: 'ledger-agent' }).id;
      let session = await adapter.resolve({ agentId });
      const completedId = parseTurnId('completed');
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: completedId,
          userMessage: userMessage('completed user', 1),
        },
        (input) => adapter.beginTurn(input)
      );
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: completedId,
          assistantMessage: assistantMessage('completed assistant', 2),
        },
        (input) => adapter.completeTurn(input)
      );
      session = await adapter.resolve({ agentId, sessionId: session.sessionId });
      const childBranchId = parseSessionBranchId('child');
      await sessionWrite(
        adapter,
        {
          ...session,
          command: {
            operation: 'rewind',
            throughTurnId: completedId,
            newBranchId: childBranchId,
            expectedRevision: session.navigationRevision,
          },
        },
        (input) => adapter.applyNavigation(input)
      );
      session = await adapter.resolve({ agentId, sessionId: session.sessionId });
      const failedId = parseTurnId('failed');
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: failedId,
          userMessage: userMessage('failed user', 3),
        },
        (input) => adapter.beginTurn(input)
      );
      await sessionWrite(
        adapter,
        { ...session, turnId: failedId, failureCode: 'MODEL_FAILED' },
        (input) => adapter.failTurn(input)
      );
      session = await adapter.resolve({ agentId, sessionId: session.sessionId });
      const activeId = parseTurnId('active');
      await sessionWrite(
        adapter,
        {
          ...session,
          turnId: activeId,
          userMessage: userMessage('active user', 4),
        },
        (input) => adapter.beginTurn(input)
      );

      const first = await adapter.listSessionTurns({ ...session, limit: 2 });
      expect(first?.records.map((turn) => [turn.turnId, turn.branchId, turn.status])).toEqual([
        [activeId, childBranchId, 'active'],
        [failedId, childBranchId, 'failed'],
      ]);
      expect(first?.nextCursor).toBe(failedId);
      const second = await adapter.listSessionTurns({
        ...session,
        ...(first?.nextCursor === undefined ? {} : { beforeTurnId: first.nextCursor }),
        limit: 2,
      });
      expect(second?.records.map((turn) => [turn.turnId, turn.branchId, turn.status])).toEqual([
        [completedId, DEFAULT_SESSION_BRANCH_ID, 'completed'],
      ]);
      expect(second?.nextCursor).toBeUndefined();
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first?.records)).toBe(true);
      expect(Object.isFrozen(first?.records[0]?.userMessage)).toBe(true);

      await expect(
        adapter.listSessionTurns({ ...session, beforeTurnId: 'missing' })
      ).rejects.toMatchObject({ code: 'TURN_NOT_FOUND' });
      await expect(
        adapter.listSessionTurns({ ...session, sessionId: 'missing' as never })
      ).resolves.toBeUndefined();
    }));
}
