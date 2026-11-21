import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { AgentSessionError, parseTurnId } from '@print-an-agent/base-session';
import { expect, it } from 'vitest';
import { withHarness } from './harness.js';
import { assistantMessage, engineAssistantMessage, userMessage } from './messages.js';
import type { SessionPortContractHarness } from './types.js';
import { sessionWrite } from './write.js';

export function defineSessionTurnContract(createHarness: () => SessionPortContractHarness): void {
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
      expect((await adapter.inspect(session))?.turns.map((turn) => turn.turnId)).toEqual([turnId]);
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
}
