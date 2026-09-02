import { defineAgentIdentity } from '@ta-agent/base-identity';
import {
  defineProviderModelReference,
  type AssistantModelMessage,
  type UserModelMessage,
} from '@ta-agent/base-model';
import { describe, expect, it } from 'vitest';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionBranchId,
  parseTurnId,
  type NavigableCompactableSessionPort,
} from '@ta-agent/base-session';

const model = defineProviderModelReference({ provider: 'faux', model: 'faux-model' });
const usage = Object.freeze({
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 3,
});

export interface SessionPortContractHarness {
  readonly adapter: NavigableCompactableSessionPort;
  readonly dispose?: () => void;
}

export function userMessage(text: string, timestamp: number): UserModelMessage {
  return Object.freeze({ role: 'user', text, timestamp });
}

export function assistantMessage(text: string, timestamp: number): AssistantModelMessage {
  return Object.freeze({
    role: 'assistant',
    text,
    provider: model.provider,
    model: model.model,
    stopReason: 'stop',
    usage,
    timestamp,
  });
}

async function withHarness<T>(
  createHarness: () => SessionPortContractHarness,
  action: (adapter: NavigableCompactableSessionPort) => Promise<T>
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
    it('loads only completed turns before the boundary in stable order', () =>
      withHarness(createHarness, async (adapter) => {
        const identity = defineAgentIdentity({ id: 'agent-a' });
        let session = await adapter.resolve({
          agentId: identity.id,
          requestedSessionId: 'chat',
        });
        const firstTurnId = parseTurnId('turn-1');
        await adapter.beginTurn({
          ...session,
          turnId: firstTurnId,
          userMessage: userMessage('one', 1),
        });
        expect(await adapter.loadHistory({ ...session, beforeTurnId: firstTurnId })).toEqual([]);
        await adapter.completeTurn({
          ...session,
          turnId: firstTurnId,
          assistantMessage: assistantMessage('first', 2),
        });

        session = await adapter.resolve({
          agentId: identity.id,
          requestedSessionId: 'chat',
        });

        const failedTurnId = parseTurnId('turn-2');
        await adapter.beginTurn({
          ...session,
          turnId: failedTurnId,
          userMessage: userMessage('failed', 3),
        });
        await adapter.failTurn({ ...session, turnId: failedTurnId, failureCode: 'FAILED' });

        const boundaryTurnId = parseTurnId('turn-3');
        await adapter.beginTurn({
          ...session,
          turnId: boundaryTurnId,
          userMessage: userMessage('three', 4),
        });
        const history = await adapter.loadHistory({
          ...session,
          beforeTurnId: boundaryTurnId,
        });

        expect(history).toEqual([userMessage('one', 1), assistantMessage('first', 2)]);
        expect(Object.isFrozen(history)).toBe(true);
        expect(Object.isFrozen(history[0])).toBe(true);
        expect(Object.isFrozen(history[1])).toBe(true);
      }));

    it('isolates the same session ID by Agent identity', () =>
      withHarness(createHarness, async (adapter) => {
        const first = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'first' }).id,
          requestedSessionId: 'shared',
        });
        const second = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'second' }).id,
          requestedSessionId: 'shared',
        });
        await adapter.beginTurn({
          ...first,
          turnId: parseTurnId('turn-first'),
          userMessage: userMessage('private', 1),
        });

        expect((await adapter.inspect(first))?.turns).toHaveLength(1);
        expect((await adapter.inspect(second))?.turns).toHaveLength(0);
      }));

    it('records failure once and rejects an invalid completion transition', () =>
      withHarness(createHarness, async (adapter) => {
        const session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'agent' }).id,
          requestedSessionId: 'chat',
        });
        const turnId = parseTurnId('turn');
        await adapter.beginTurn({
          ...session,
          turnId,
          userMessage: userMessage('hello', 1),
        });

        const failed = await adapter.failTurn({
          ...session,
          turnId,
          failureCode: 'PROVIDER_FAILED',
        });
        expect(failed).toMatchObject({ status: 'failed', failureCode: 'PROVIDER_FAILED' });
        expect(await adapter.failTurn({ ...session, turnId, failureCode: 'OTHER' })).toEqual(
          failed
        );
        await expect(
          adapter.completeTurn({
            ...session,
            turnId,
            assistantMessage: assistantMessage('late', 2),
          })
        ).rejects.toEqual(
          expect.objectContaining<Partial<AgentSessionError>>({ code: 'TURN_STATE_INVALID' })
        );
      }));

    it('rejects duplicate turn authority and a second active turn on one branch', () =>
      withHarness(createHarness, async (adapter) => {
        const session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'agent' }).id,
          requestedSessionId: 'chat',
        });
        const turnId = parseTurnId('turn');
        await adapter.beginTurn({
          ...session,
          turnId,
          userMessage: userMessage('hello', 1),
        });

        await expect(
          adapter.beginTurn({
            ...session,
            turnId,
            userMessage: userMessage('duplicate', 2),
          })
        ).rejects.toEqual(
          expect.objectContaining<Partial<AgentSessionError>>({ code: 'TURN_ALREADY_EXISTS' })
        );

        const secondId = parseTurnId('turn-next');
        await expect(
          adapter.beginTurn({
            ...session,
            turnId: secondId,
            userMessage: userMessage('next', 3),
          })
        ).rejects.toMatchObject({ code: 'SESSION_BRANCH_BUSY' });
        expect((await adapter.inspect(session))?.turns.map((turn) => turn.turnId)).toEqual([
          turnId,
        ]);
      }));

    it('returns detached immutable snapshots and validates failure codes', () =>
      withHarness(createHarness, async (adapter) => {
        const session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'agent' }).id,
          requestedSessionId: 'chat',
        });
        const turnId = parseTurnId('turn');
        await adapter.beginTurn({
          ...session,
          turnId,
          userMessage: userMessage('hello', 1),
        });

        await expect(
          adapter.failTurn({ ...session, turnId, failureCode: 'invalid failure code' })
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
          requestedSessionId: 'context-chat',
        });
        const firstTurnId = parseTurnId('one');
        const secondTurnId = parseTurnId('two');
        const thirdTurnId = parseTurnId('three');
        const boundaryTurnId = parseTurnId('boundary');
        const turnIds = [firstTurnId, secondTurnId, thirdTurnId, boundaryTurnId];
        for (const [index, turnId] of turnIds.entries()) {
          session = await adapter.resolve({
            agentId: defineAgentIdentity({ id: 'context-agent' }).id,
            requestedSessionId: 'context-chat',
          });
          await adapter.beginTurn({
            ...session,
            turnId,
            userMessage: userMessage(`user-${index}`, index * 2 + 1),
          });
          if (index < 3) {
            await adapter.completeTurn({
              ...session,
              turnId,
              assistantMessage: assistantMessage(`assistant-${index}`, index * 2 + 2),
            });
          }
        }

        const rawContext = await adapter.loadContext({
          ...session,
          beforeTurnId: boundaryTurnId,
        });
        expect(rawContext.compaction).toBeUndefined();
        expect(rawContext.messages).toHaveLength(6);

        const committed = await adapter.commitCompaction({
          ...session,
          expectedRevision: 0,
          throughTurnId: secondTurnId,
          context: Object.freeze({ role: 'context', text: 'summary', timestamp: 10 }),
        });
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
          requestedSessionId: 'cas-chat',
        });
        const first = parseTurnId('first');
        const second = parseTurnId('second');
        for (const [index, turnId] of [first, second].entries()) {
          session = await adapter.resolve({
            agentId: defineAgentIdentity({ id: 'cas-agent' }).id,
            requestedSessionId: 'cas-chat',
          });
          await adapter.beginTurn({
            ...session,
            turnId,
            userMessage: userMessage(`u${index}`, index + 1),
          });
          await adapter.completeTurn({
            ...session,
            turnId,
            assistantMessage: assistantMessage(`a${index}`, index + 3),
          });
        }
        await adapter.commitCompaction({
          ...session,
          expectedRevision: 0,
          throughTurnId: first,
          context: { role: 'context', text: 'first summary', timestamp: 10 },
        });

        await expect(
          adapter.commitCompaction({
            ...session,
            expectedRevision: 0,
            throughTurnId: second,
            context: { role: 'context', text: 'stale', timestamp: 11 },
          })
        ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_CONFLICT' });
        await expect(
          adapter.commitCompaction({
            ...session,
            expectedRevision: 1,
            throughTurnId: first,
            context: { role: 'context', text: 'regression', timestamp: 12 },
          })
        ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_CONFLICT' });

        const advanced = await adapter.commitCompaction({
          ...session,
          expectedRevision: 1,
          throughTurnId: second,
          context: { role: 'context', text: 'second summary', timestamp: 13 },
        });

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
          requestedSessionId: 'active-chat',
        });
        const turnId = parseTurnId('active');
        await adapter.beginTurn({
          ...session,
          turnId,
          userMessage: userMessage('pending', 1),
        });

        await expect(
          adapter.commitCompaction({
            ...session,
            expectedRevision: 0,
            throughTurnId: turnId,
            context: { role: 'context', text: 'invalid', timestamp: 2 },
          })
        ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_INVALID' });
        expect(await adapter.readCompaction(session)).toBeUndefined();
      }));

    it('creates one default branch and rejects stale or concurrent request authority', () =>
      withHarness(createHarness, async (adapter) => {
        const identity = defineAgentIdentity({ id: 'navigation-authority-agent' });
        const initial = await adapter.resolve({
          agentId: identity.id,
          requestedSessionId: 'navigation-authority',
        });
        expect(initial).toMatchObject({
          branchId: DEFAULT_SESSION_BRANCH_ID,
          navigationRevision: 0,
        });
        const firstTurnId = parseTurnId('first-active');
        await adapter.beginTurn({
          ...initial,
          turnId: firstTurnId,
          userMessage: userMessage('first', 1),
        });
        await expect(
          adapter.beginTurn({
            ...initial,
            turnId: parseTurnId('second-active'),
            userMessage: userMessage('second', 2),
          })
        ).rejects.toMatchObject({ code: 'SESSION_BRANCH_BUSY' });
        await adapter.completeTurn({
          ...initial,
          turnId: firstTurnId,
          assistantMessage: assistantMessage('done', 3),
        });
        await expect(
          adapter.beginTurn({
            ...initial,
            turnId: parseTurnId('stale'),
            userMessage: userMessage('stale', 4),
          })
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
        const sessionId = 'navigation-chat';
        const mainTurns = [
          parseTurnId('main-one'),
          parseTurnId('main-two'),
          parseTurnId('main-three'),
        ];
        for (const [index, turnId] of mainTurns.entries()) {
          const current = await adapter.resolve({
            agentId: identity.id,
            requestedSessionId: sessionId,
          });
          await adapter.beginTurn({
            ...current,
            turnId,
            userMessage: userMessage(`main-user-${index}`, index * 2 + 1),
          });
          await adapter.completeTurn({
            ...current,
            turnId,
            assistantMessage: assistantMessage(`main-assistant-${index}`, index * 2 + 2),
          });
        }
        const reference = await adapter.resolve({
          agentId: identity.id,
          requestedSessionId: sessionId,
        });
        const childBranchId = parseSessionBranchId('child');
        const forked = await adapter.applyNavigation({
          ...reference,
          command: {
            operation: 'fork',
            sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
            throughTurnId: mainTurns[0]!,
            newBranchId: childBranchId,
            expectedRevision: reference.navigationRevision,
          },
        });
        expect(forked).toMatchObject({
          operation: 'fork',
          affectedBranchId: childBranchId,
          navigation: { selectedBranchId: DEFAULT_SESSION_BRANCH_ID, revision: 4 },
        });
        const selected = await adapter.applyNavigation({
          ...reference,
          command: {
            operation: 'select',
            branchId: childBranchId,
            expectedRevision: 4,
          },
        });
        expect(selected.navigation).toMatchObject({ selectedBranchId: childBranchId, revision: 5 });

        const child = await adapter.resolve({
          agentId: identity.id,
          requestedSessionId: sessionId,
        });
        const childTurnId = parseTurnId('child-turn');
        await adapter.beginTurn({
          ...child,
          turnId: childTurnId,
          userMessage: userMessage('child-user', 10),
        });
        expect(await adapter.loadHistory({ ...child, beforeTurnId: childTurnId })).toEqual([
          userMessage('main-user-0', 1),
          assistantMessage('main-assistant-0', 2),
        ]);
        await adapter.completeTurn({
          ...child,
          turnId: childTurnId,
          assistantMessage: assistantMessage('child-assistant', 11),
        });

        const beforeRewind = await adapter.resolve({
          agentId: identity.id,
          requestedSessionId: sessionId,
        });
        const rewindBranchId = parseSessionBranchId('rewound');
        const rewound = await adapter.applyNavigation({
          ...beforeRewind,
          command: {
            operation: 'rewind',
            throughTurnId: mainTurns[0]!,
            newBranchId: rewindBranchId,
            expectedRevision: beforeRewind.navigationRevision,
          },
        });
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
        const sessionId = 'navigation-compaction';
        const turnIds = [parseTurnId('one'), parseTurnId('two'), parseTurnId('three')];
        for (const [index, turnId] of turnIds.entries()) {
          const current = await adapter.resolve({
            agentId: identity.id,
            requestedSessionId: sessionId,
          });
          await adapter.beginTurn({
            ...current,
            turnId,
            userMessage: userMessage(`u${index}`, index * 2 + 1),
          });
          await adapter.completeTurn({
            ...current,
            turnId,
            assistantMessage: assistantMessage(`a${index}`, index * 2 + 2),
          });
        }
        const main = await adapter.resolve({
          agentId: identity.id,
          requestedSessionId: sessionId,
        });
        await adapter.commitCompaction({
          ...main,
          expectedRevision: 0,
          throughTurnId: turnIds[1]!,
          context: { role: 'context', text: 'main summary', timestamp: 20 },
        });
        const safeBranchId = parseSessionBranchId('safe');
        await adapter.applyNavigation({
          ...main,
          command: {
            operation: 'fork',
            sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
            throughTurnId: turnIds[2]!,
            newBranchId: safeBranchId,
            expectedRevision: main.navigationRevision,
          },
        });
        expect(await adapter.readCompaction({ ...main, branchId: safeBranchId })).toMatchObject({
          branchId: safeBranchId,
          revision: 1,
          throughTurnId: turnIds[1],
          context: { text: 'main summary' },
        });

        const afterSafe = await adapter.resolve({
          agentId: identity.id,
          requestedSessionId: sessionId,
        });
        const unsafeBranchId = parseSessionBranchId('unsafe');
        await adapter.applyNavigation({
          ...afterSafe,
          command: {
            operation: 'fork',
            sourceBranchId: DEFAULT_SESSION_BRANCH_ID,
            throughTurnId: turnIds[0]!,
            newBranchId: unsafeBranchId,
            expectedRevision: afterSafe.navigationRevision,
          },
        });
        expect(
          await adapter.readCompaction({ ...afterSafe, branchId: unsafeBranchId })
        ).toBeUndefined();
      }));
  });
}
