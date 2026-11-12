import { sessionWrite } from './session-write.js';
import { defineAgentIdentity } from '@print-an-agent/base-identity';
import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
  defineProviderModelExecutionProvenance,
  defineProviderModelReference,
  type AssistantModelMessage,
  type UserModelMessage,
} from '@print-an-agent/model-invocation-core';
import { describe, expect, it } from 'vitest';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionBranchId,
  parseTurnId,
  type NavigableCompactableSessionPort,
  type SessionMetadataPort,
  type SessionQueryPort,
} from '@print-an-agent/base-session';

const model = defineProviderModelReference({ provider: 'faux', model: 'faux-model' });
const usage = Object.freeze({
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 3,
});

export interface SessionPortContractHarness {
  readonly adapter: NavigableCompactableSessionPort & SessionQueryPort & SessionMetadataPort;
  readonly dispose?: () => void;
}

export function userMessage(text: string, timestamp: number): UserModelMessage {
  return Object.freeze({ role: 'user', text, timestamp });
}

export function assistantMessage(text: string, timestamp: number): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineProviderModelExecutionProvenance(model),
    stopReason: 'stop',
    usage: { ...usage },
    timestamp,
  });
}

export function engineAssistantMessage(text: string, timestamp: number): AssistantModelMessage {
  return defineAssistantModelMessage({
    role: 'assistant',
    text,
    provenance: defineEngineDefinedModelExecutionProvenance({
      type: 'test.runtime-target',
      evidence: {
        artifact: { id: 'artifact-1', revision: 3 },
        route: ['embedded', 'generation-7'],
      },
    }),
    stopReason: 'stop',
    usage: { ...usage },
    timestamp,
  });
}

async function withHarness<T>(
  createHarness: () => SessionPortContractHarness,
  action: (
    adapter: NavigableCompactableSessionPort & SessionQueryPort & SessionMetadataPort
  ) => Promise<T>
): Promise<T> {
  const harness = createHarness();
  try {
    return await action(harness.adapter);
  } finally {
    harness.dispose?.();
  }
}

export function defineSessionPortContract(
  adapterName: string,
  createHarness: () => SessionPortContractHarness
): void {
  describe(`${adapterName} SessionPort contract`, () => {
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

    it('loads only completed turns before the boundary in stable order', () =>
      withHarness(createHarness, async (adapter) => {
        const identity = defineAgentIdentity({ id: 'agent-a' });
        let session = await adapter.resolve({
          agentId: identity.id,
        });
        const firstTurnId = parseTurnId('turn-1');
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId: firstTurnId,
            userMessage: userMessage('one', 1),
          },
          (input) => adapter.beginTurn(input)
        );
        expect(await adapter.loadHistory({ ...session, beforeTurnId: firstTurnId })).toEqual([]);
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId: firstTurnId,
            assistantMessage: assistantMessage('first', 2),
          },
          (input) => adapter.completeTurn(input)
        );

        session = await adapter.resolve({
          agentId: identity.id,
          sessionId: session.sessionId,
        });

        const failedTurnId = parseTurnId('turn-2');
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId: failedTurnId,
            userMessage: userMessage('failed', 3),
          },
          (input) => adapter.beginTurn(input)
        );
        await sessionWrite(
          adapter,
          { ...session, turnId: failedTurnId, failureCode: 'FAILED' },
          (input) => adapter.failTurn(input)
        );

        const boundaryTurnId = parseTurnId('turn-3');
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId: boundaryTurnId,
            userMessage: userMessage('three', 4),
          },
          (input) => adapter.beginTurn(input)
        );
        const history = await adapter.loadHistory({
          ...session,
          beforeTurnId: boundaryTurnId,
        });

        expect(history).toEqual([userMessage('one', 1), assistantMessage('first', 2)]);
        expect(Object.isFrozen(history)).toBe(true);
        expect(Object.isFrozen(history[0])).toBe(true);
        expect(Object.isFrozen(history[1])).toBe(true);
      }));

    it('round-trips deeply immutable engine-defined provenance through Session history', () =>
      withHarness(createHarness, async (adapter) => {
        const agentId = defineAgentIdentity({ id: 'engine-evidence-agent' }).id;
        let session = await adapter.resolve({
          agentId,
        });
        const completedTurnId = parseTurnId('completed');
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId: completedTurnId,
            userMessage: userMessage('invoke custom engine', 1),
          },
          (input) => adapter.beginTurn(input)
        );
        const expected = engineAssistantMessage('custom result', 2);
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId: completedTurnId,
            assistantMessage: expected,
          },
          (input) => adapter.completeTurn(input)
        );
        session = await adapter.resolve({
          agentId,
          sessionId: session.sessionId,
        });
        const boundaryTurnId = parseTurnId('boundary');
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId: boundaryTurnId,
            userMessage: userMessage('continue', 3),
          },
          (input) => adapter.beginTurn(input)
        );

        const history = await adapter.loadHistory({ ...session, beforeTurnId: boundaryTurnId });
        expect(history).toEqual([userMessage('invoke custom engine', 1), expected]);
        const provenance = history[1]?.role === 'assistant' ? history[1].provenance : undefined;
        expect(provenance?.kind).toBe('engine-defined');
        if (provenance?.kind === 'engine-defined') {
          expect(Object.isFrozen(provenance.evidence)).toBe(true);
          expect(Object.isFrozen(provenance.evidence.artifact)).toBe(true);
          expect(Object.isFrozen(provenance.evidence.route)).toBe(true);
        }
      }));

    it('keeps Session access scoped to the owning Agent', () =>
      withHarness(createHarness, async (adapter) => {
        const first = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'first' }).id,
        });
        const second = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'second' }).id,
        });
        await sessionWrite(
          adapter,
          {
            ...first,
            turnId: parseTurnId('turn-first'),
            userMessage: userMessage('private', 1),
          },
          (input) => adapter.beginTurn(input)
        );

        expect((await adapter.inspect(first))?.turns).toHaveLength(1);
        expect((await adapter.inspect(second))?.turns).toHaveLength(0);
        await expect(
          adapter.resolve({ agentId: second.agentId, sessionId: first.sessionId })
        ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
      }));

    it('records failure once and rejects an invalid completion transition', () =>
      withHarness(createHarness, async (adapter) => {
        const session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'agent' }).id,
        });
        const turnId = parseTurnId('turn');
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId,
            userMessage: userMessage('hello', 1),
          },
          (input) => adapter.beginTurn(input)
        );

        const failed = await sessionWrite(
          adapter,
          {
            ...session,
            turnId,
            failureCode: 'PROVIDER_FAILED',
          },
          (input) => adapter.failTurn(input)
        );
        expect(failed).toMatchObject({ status: 'failed', failureCode: 'PROVIDER_FAILED' });
        expect(
          await sessionWrite(adapter, { ...session, turnId, failureCode: 'OTHER' }, (input) =>
            adapter.failTurn(input)
          )
        ).toEqual(failed);
        await expect(
          sessionWrite(
            adapter,
            {
              ...session,
              turnId,
              assistantMessage: assistantMessage('late', 2),
            },
            (input) => adapter.completeTurn(input)
          )
        ).rejects.toEqual(
          expect.objectContaining<Partial<AgentSessionError>>({ code: 'TURN_STATE_INVALID' })
        );
      }));

    it('rejects duplicate turn authority and a second active turn on one branch', () =>
      withHarness(createHarness, async (adapter) => {
        const session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'agent' }).id,
        });
        const turnId = parseTurnId('turn');
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId,
            userMessage: userMessage('hello', 1),
          },
          (input) => adapter.beginTurn(input)
        );

        await expect(
          sessionWrite(
            adapter,
            {
              ...session,
              turnId,
              userMessage: userMessage('duplicate', 2),
            },
            (input) => adapter.beginTurn(input)
          )
        ).rejects.toEqual(
          expect.objectContaining<Partial<AgentSessionError>>({ code: 'TURN_ALREADY_EXISTS' })
        );

        const secondId = parseTurnId('turn-next');
        await expect(
          sessionWrite(
            adapter,
            {
              ...session,
              turnId: secondId,
              userMessage: userMessage('next', 3),
            },
            (input) => adapter.beginTurn(input)
          )
        ).rejects.toMatchObject({ code: 'SESSION_BRANCH_BUSY' });
        expect((await adapter.inspect(session))?.turns.map((turn) => turn.turnId)).toEqual([
          turnId,
        ]);
      }));

    it('returns detached immutable snapshots and validates failure codes', () =>
      withHarness(createHarness, async (adapter) => {
        const session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'agent' }).id,
        });
        const turnId = parseTurnId('turn');
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId,
            userMessage: userMessage('hello', 1),
          },
          (input) => adapter.beginTurn(input)
        );

        await expect(
          sessionWrite(
            adapter,
            { ...session, turnId, failureCode: 'invalid failure code' },
            (input) => adapter.failTurn(input)
          )
        ).rejects.toEqual(
          expect.objectContaining<Partial<AgentSessionError>>({
            code: 'SESSION_FAILURE_CODE_INVALID',
          })
        );
        const snapshot = await adapter.inspect(session);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot?.turns)).toBe(true);
        expect(Object.isFrozen(snapshot?.turns[0]?.userMessage)).toBe(true);
      }));

    it('loads raw context before compaction and projection plus exact tail after compaction', () =>
      withHarness(createHarness, async (adapter) => {
        let session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'context-agent' }).id,
        });
        const firstTurnId = parseTurnId('one');
        const secondTurnId = parseTurnId('two');
        const thirdTurnId = parseTurnId('three');
        const boundaryTurnId = parseTurnId('boundary');
        const turnIds = [firstTurnId, secondTurnId, thirdTurnId, boundaryTurnId];
        for (const [index, turnId] of turnIds.entries()) {
          session = await adapter.resolve({
            agentId: defineAgentIdentity({ id: 'context-agent' }).id,
            sessionId: session.sessionId,
          });
          await sessionWrite(
            adapter,
            {
              ...session,
              turnId,
              userMessage: userMessage(`user-${index}`, index * 2 + 1),
            },
            (input) => adapter.beginTurn(input)
          );
          if (index < 3) {
            await sessionWrite(
              adapter,
              {
                ...session,
                turnId,
                assistantMessage: assistantMessage(`assistant-${index}`, index * 2 + 2),
              },
              (input) => adapter.completeTurn(input)
            );
          }
        }

        const rawContext = await adapter.loadContext({
          ...session,
          beforeTurnId: boundaryTurnId,
        });
        expect(rawContext.compaction).toBeUndefined();
        expect(rawContext.messages).toHaveLength(6);

        const committed = await sessionWrite(
          adapter,
          {
            ...session,
            expectedRevision: 0,
            throughTurnId: secondTurnId,
            context: Object.freeze({ role: 'context', text: 'summary', timestamp: 10 }),
          },
          (input) => adapter.commitCompaction(input)
        );
        const compactedContext = await adapter.loadContext({
          ...session,
          beforeTurnId: boundaryTurnId,
        });

        expect(committed).toMatchObject({ revision: 1, throughTurnId: secondTurnId });
        expect(compactedContext.messages).toEqual([
          { role: 'context', text: 'summary', timestamp: 10 },
          userMessage('user-2', 5),
          assistantMessage('assistant-2', 6),
        ]);
        expect(
          await adapter.loadHistory({ ...session, beforeTurnId: boundaryTurnId })
        ).toHaveLength(6);
        expect(Object.isFrozen(compactedContext.messages)).toBe(true);
        expect(Object.isFrozen(compactedContext.compaction?.context)).toBe(true);
      }));

    it('uses revision CAS and requires every compaction boundary to advance', () =>
      withHarness(createHarness, async (adapter) => {
        let session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'cas-agent' }).id,
        });
        const first = parseTurnId('first');
        const second = parseTurnId('second');
        for (const [index, turnId] of [first, second].entries()) {
          session = await adapter.resolve({
            agentId: defineAgentIdentity({ id: 'cas-agent' }).id,
            sessionId: session.sessionId,
          });
          await sessionWrite(
            adapter,
            {
              ...session,
              turnId,
              userMessage: userMessage(`u${index}`, index + 1),
            },
            (input) => adapter.beginTurn(input)
          );
          await sessionWrite(
            adapter,
            {
              ...session,
              turnId,
              assistantMessage: assistantMessage(`a${index}`, index + 3),
            },
            (input) => adapter.completeTurn(input)
          );
        }
        await sessionWrite(
          adapter,
          {
            ...session,
            expectedRevision: 0,
            throughTurnId: first,
            context: { role: 'context', text: 'first summary', timestamp: 10 },
          },
          (input) => adapter.commitCompaction(input)
        );

        await expect(
          sessionWrite(
            adapter,
            {
              ...session,
              expectedRevision: 0,
              throughTurnId: second,
              context: { role: 'context', text: 'stale', timestamp: 11 },
            },
            (input) => adapter.commitCompaction(input)
          )
        ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_CONFLICT' });
        await expect(
          sessionWrite(
            adapter,
            {
              ...session,
              expectedRevision: 1,
              throughTurnId: first,
              context: { role: 'context', text: 'regression', timestamp: 12 },
            },
            (input) => adapter.commitCompaction(input)
          )
        ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_CONFLICT' });

        const advanced = await sessionWrite(
          adapter,
          {
            ...session,
            expectedRevision: 1,
            throughTurnId: second,
            context: { role: 'context', text: 'second summary', timestamp: 13 },
          },
          (input) => adapter.commitCompaction(input)
        );

        expect(advanced).toMatchObject({
          revision: 2,
          throughTurnId: second,
          context: { text: 'second summary' },
        });
        expect(await adapter.readCompaction(session)).toMatchObject({
          revision: 2,
          throughTurnId: second,
          context: { text: 'second summary' },
        });
      }));

    it('rejects an active turn as compaction authority', () =>
      withHarness(createHarness, async (adapter) => {
        const session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'active-agent' }).id,
        });
        const turnId = parseTurnId('active');
        await sessionWrite(
          adapter,
          {
            ...session,
            turnId,
            userMessage: userMessage('pending', 1),
          },
          (input) => adapter.beginTurn(input)
        );

        await expect(
          sessionWrite(
            adapter,
            {
              ...session,
              expectedRevision: 0,
              throughTurnId: turnId,
              context: { role: 'context', text: 'invalid', timestamp: 2 },
            },
            (input) => adapter.commitCompaction(input)
          )
        ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_INVALID' });
        expect(await adapter.readCompaction(session)).toBeUndefined();
      }));

    it('creates one default branch and rejects stale or concurrent request authority', () =>
      withHarness(createHarness, async (adapter) => {
        const identity = defineAgentIdentity({ id: 'navigation-authority-agent' });
        const initial = await adapter.resolve({
          agentId: identity.id,
        });
        expect(initial).toMatchObject({
          branchId: DEFAULT_SESSION_BRANCH_ID,
          navigationRevision: 0,
        });
        const firstTurnId = parseTurnId('first-active');
        await sessionWrite(
          adapter,
          {
            ...initial,
            turnId: firstTurnId,
            userMessage: userMessage('first', 1),
          },
          (input) => adapter.beginTurn(input)
        );
        await expect(
          sessionWrite(
            adapter,
            {
              ...initial,
              turnId: parseTurnId('second-active'),
              userMessage: userMessage('second', 2),
            },
            (input) => adapter.beginTurn(input)
          )
        ).rejects.toMatchObject({ code: 'SESSION_BRANCH_BUSY' });
        await sessionWrite(
          adapter,
          {
            ...initial,
            turnId: firstTurnId,
            assistantMessage: assistantMessage('done', 3),
          },
          (input) => adapter.completeTurn(input)
        );
        await expect(
          sessionWrite(
            adapter,
            {
              ...initial,
              turnId: parseTurnId('stale'),
              userMessage: userMessage('stale', 4),
            },
            (input) => adapter.beginTurn(input)
          )
        ).rejects.toMatchObject({ code: 'SESSION_NAVIGATION_CONFLICT' });

        const snapshot = await adapter.inspect(initial);
        expect(snapshot?.navigation).toMatchObject({
          revision: 1,
          selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
          branches: [{ branchId: DEFAULT_SESSION_BRANCH_ID, headTurnId: firstTurnId }],
        });
        expect(Object.isFrozen(snapshot?.navigation.branches)).toBe(true);
      }));

    it('forks, selects, and rewinds without moving or rewriting source history', () =>
      withHarness(createHarness, async (adapter) => {
        const identity = defineAgentIdentity({ id: 'navigation-agent' });
        const { sessionId } = await adapter.resolve({ agentId: identity.id });
        const mainTurns = [
          parseTurnId('main-one'),
          parseTurnId('main-two'),
          parseTurnId('main-three'),
        ];
        for (const [index, turnId] of mainTurns.entries()) {
          const current = await adapter.resolve({
            agentId: identity.id,
            sessionId: sessionId,
          });
          await sessionWrite(
            adapter,
            {
              ...current,
              turnId,
              userMessage: userMessage(`main-user-${index}`, index * 2 + 1),
            },
            (input) => adapter.beginTurn(input)
          );
          await sessionWrite(
            adapter,
            {
              ...current,
              turnId,
              assistantMessage: assistantMessage(`main-assistant-${index}`, index * 2 + 2),
            },
            (input) => adapter.completeTurn(input)
          );
        }
        const reference = await adapter.resolve({
          agentId: identity.id,
          sessionId: sessionId,
        });
        const childBranchId = parseSessionBranchId('child');
        const forked = await sessionWrite(
          adapter,
          {
            ...reference,
            command: {
              operation: 'fork',
              sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
              throughTurnId: mainTurns[0]!,
              newBranchId: childBranchId,
              expectedRevision: reference.navigationRevision,
            },
          },
          (input) => adapter.applyNavigation(input)
        );
        expect(forked).toMatchObject({
          operation: 'fork',
          affectedBranchId: childBranchId,
          navigation: { selectedBranchId: DEFAULT_SESSION_BRANCH_ID, revision: 4 },
        });
        const selected = await sessionWrite(
          adapter,
          {
            ...reference,
            command: {
              operation: 'select',
              branchId: childBranchId,
              expectedRevision: 4,
            },
          },
          (input) => adapter.applyNavigation(input)
        );
        expect(selected.navigation).toMatchObject({ selectedBranchId: childBranchId, revision: 5 });

        const child = await adapter.resolve({
          agentId: identity.id,
          sessionId: sessionId,
        });
        const childTurnId = parseTurnId('child-turn');
        await sessionWrite(
          adapter,
          {
            ...child,
            turnId: childTurnId,
            userMessage: userMessage('child-user', 10),
          },
          (input) => adapter.beginTurn(input)
        );
        expect(await adapter.loadHistory({ ...child, beforeTurnId: childTurnId })).toEqual([
          userMessage('main-user-0', 1),
          assistantMessage('main-assistant-0', 2),
        ]);
        await sessionWrite(
          adapter,
          {
            ...child,
            turnId: childTurnId,
            assistantMessage: assistantMessage('child-assistant', 11),
          },
          (input) => adapter.completeTurn(input)
        );

        const beforeRewind = await adapter.resolve({
          agentId: identity.id,
          sessionId: sessionId,
        });
        const rewindBranchId = parseSessionBranchId('rewound');
        const rewound = await sessionWrite(
          adapter,
          {
            ...beforeRewind,
            command: {
              operation: 'rewind',
              throughTurnId: mainTurns[0]!,
              newBranchId: rewindBranchId,
              expectedRevision: beforeRewind.navigationRevision,
            },
          },
          (input) => adapter.applyNavigation(input)
        );
        expect(rewound.navigation).toMatchObject({
          selectedBranchId: rewindBranchId,
          revision: 7,
        });
        const snapshot = await adapter.inspect(reference);
        expect(snapshot?.navigation.branches).toMatchObject([
          { branchId: DEFAULT_SESSION_BRANCH_ID, headTurnId: mainTurns[2] },
          { branchId: childBranchId, headTurnId: childTurnId },
          { branchId: rewindBranchId, headTurnId: mainTurns[0] },
        ]);
        expect(snapshot?.turns).toHaveLength(4);
      }));

    it('inherits only a compaction projection safe for the new branch point', () =>
      withHarness(createHarness, async (adapter) => {
        const identity = defineAgentIdentity({ id: 'navigation-compaction-agent' });
        const { sessionId } = await adapter.resolve({ agentId: identity.id });
        const turnIds = [parseTurnId('one'), parseTurnId('two'), parseTurnId('three')];
        for (const [index, turnId] of turnIds.entries()) {
          const current = await adapter.resolve({
            agentId: identity.id,
            sessionId: sessionId,
          });
          await sessionWrite(
            adapter,
            {
              ...current,
              turnId,
              userMessage: userMessage(`u${index}`, index * 2 + 1),
            },
            (input) => adapter.beginTurn(input)
          );
          await sessionWrite(
            adapter,
            {
              ...current,
              turnId,
              assistantMessage: assistantMessage(`a${index}`, index * 2 + 2),
            },
            (input) => adapter.completeTurn(input)
          );
        }
        const main = await adapter.resolve({
          agentId: identity.id,
          sessionId: sessionId,
        });
        await sessionWrite(
          adapter,
          {
            ...main,
            expectedRevision: 0,
            throughTurnId: turnIds[1]!,
            context: { role: 'context', text: 'main summary', timestamp: 20 },
          },
          (input) => adapter.commitCompaction(input)
        );
        const safeBranchId = parseSessionBranchId('safe');
        await sessionWrite(
          adapter,
          {
            ...main,
            command: {
              operation: 'fork',
              sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
              throughTurnId: turnIds[2]!,
              newBranchId: safeBranchId,
              expectedRevision: main.navigationRevision,
            },
          },
          (input) => adapter.applyNavigation(input)
        );
        expect(await adapter.readCompaction({ ...main, branchId: safeBranchId })).toMatchObject({
          branchId: safeBranchId,
          revision: 1,
          throughTurnId: turnIds[1],
          context: { text: 'main summary' },
        });

        const afterSafe = await adapter.resolve({
          agentId: identity.id,
          sessionId: sessionId,
        });
        const unsafeBranchId = parseSessionBranchId('unsafe');
        await sessionWrite(
          adapter,
          {
            ...afterSafe,
            command: {
              operation: 'fork',
              sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
              throughTurnId: turnIds[0]!,
              newBranchId: unsafeBranchId,
              expectedRevision: afterSafe.navigationRevision,
            },
          },
          (input) => adapter.applyNavigation(input)
        );
        expect(
          await adapter.readCompaction({ ...afterSafe, branchId: unsafeBranchId })
        ).toBeUndefined();
      }));
  });
}
