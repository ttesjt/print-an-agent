import { defineAgentIdentity } from '@ta-agent/base-identity';
import {
  defineProviderModelReference,
  type AssistantModelMessage,
  type UserModelMessage,
} from '@ta-agent/base-model';
import { describe, expect, it } from 'vitest';
import { AgentSessionError, parseTurnId, type CompactableSessionPort } from '../../src/index.js';

const model = defineProviderModelReference({ provider: 'faux', model: 'faux-model' });
const usage = Object.freeze({
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 3,
});

export interface SessionPortContractHarness {
  readonly adapter: CompactableSessionPort;
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
  action: (adapter: CompactableSessionPort) => Promise<T>
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
        const session = await adapter.resolve({
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

    it('rejects duplicate turn authority without changing turn order', () =>
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
        await adapter.beginTurn({
          ...session,
          turnId: secondId,
          userMessage: userMessage('next', 3),
        });
        expect((await adapter.inspect(session))?.turns.map((turn) => turn.turnId)).toEqual([
          turnId,
          secondId,
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
        const session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'context-agent' }).id,
          requestedSessionId: 'context-chat',
        });
        const firstTurnId = parseTurnId('one');
        const secondTurnId = parseTurnId('two');
        const thirdTurnId = parseTurnId('three');
        const boundaryTurnId = parseTurnId('boundary');
        const turnIds = [firstTurnId, secondTurnId, thirdTurnId, boundaryTurnId];
        for (const [index, turnId] of turnIds.entries()) {
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
        const session = await adapter.resolve({
          agentId: defineAgentIdentity({ id: 'cas-agent' }).id,
          requestedSessionId: 'cas-chat',
        });
        const first = parseTurnId('first');
        const second = parseTurnId('second');
        for (const [index, turnId] of [first, second].entries()) {
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
  });
}
