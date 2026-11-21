import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { parseTurnId } from '@print-an-agent/base-session';
import { expect, it } from 'vitest';
import { withHarness } from './harness.js';
import { assistantMessage, userMessage } from './messages.js';
import type { SessionPortContractHarness } from './types.js';
import { sessionWrite } from './write.js';

export function defineSessionCompactionContract(
  createHarness: () => SessionPortContractHarness
): void {
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
      expect(await adapter.loadHistory({ ...session, beforeTurnId: boundaryTurnId })).toHaveLength(
        6
      );
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
}
