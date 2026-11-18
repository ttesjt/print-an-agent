import assert from 'node:assert/strict';
import { parseAgentId } from '@print-an-agent/base-identity';
import {
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionId,
  type ActiveSessionTurn,
  type CompactableSessionPort,
  type CompletedSessionTurn,
  type ResolvedSessionReference,
  type SessionCompaction,
  type SessionReference,
} from '@print-an-agent/base-session';

interface SessionFixture {
  readonly reference: ResolvedSessionReference;
  readonly port: CompactableSessionPort;
  readonly completed: readonly CompletedSessionTurn[];
  readonly compactions: readonly SessionCompaction[];
}

/** A narrow test port, not a persistence implementation; unexpected operations fail explicitly. */
export function sessionFixture(turns: readonly CompletedSessionTurn[] = []): SessionFixture {
  const reference = {
    agentId: parseAgentId('packed-consumer'),
    sessionId: parseSessionId('session'),
    branchId: DEFAULT_SESSION_BRANCH_ID,
    navigationRevision: 0,
  };
  const assertReference = (input: SessionReference) => {
    assert.equal(input.agentId, reference.agentId);
    assert.equal(input.sessionId, reference.sessionId);
  };
  const headTurnId = turns.at(-1)?.turnId;
  const snapshot = {
    ...reference,
    turns,
    navigation: {
      ...reference,
      revision: 0,
      selectedBranchId: reference.branchId,
      branches: [
        {
          branchId: reference.branchId,
          createdAt: 0,
          ...(headTurnId === undefined ? {} : { headTurnId }),
        },
      ],
    },
  };
  let active: ActiveSessionTurn | undefined;
  const completed: CompletedSessionTurn[] = [];
  const compactions: SessionCompaction[] = [];
  const port: CompactableSessionPort = {
    resolve: (input) => {
      assert.equal(input.agentId, reference.agentId);
      if (input.sessionId !== undefined) assert.equal(input.sessionId, reference.sessionId);
      return Promise.resolve(reference);
    },
    beginTurn: (input) => {
      assertReference(input);
      assert.equal(input.branchId, reference.branchId);
      assert.equal(active, undefined);
      active = {
        status: 'active',
        turnId: input.turnId,
        branchId: input.branchId,
        userMessage: input.userMessage,
      };
      return Promise.resolve(active);
    },
    completeTurn: (input) => {
      assertReference(input);
      assert.ok(active);
      assert.equal(input.turnId, active.turnId);
      const turn: CompletedSessionTurn = {
        ...active,
        status: 'completed',
        assistantMessage: input.assistantMessage,
      };
      completed.push(turn);
      active = undefined;
      return Promise.resolve(turn);
    },
    loadContext: (input) => {
      assertReference(input);
      return Promise.resolve({ ...reference, messages: [] });
    },
    loadHistory: () => Promise.reject(new Error('Unexpected raw history read.')),
    failTurn: () => Promise.reject(new Error('Unexpected failure cleanup in successful fixture.')),
    inspect: (input) => {
      assertReference(input);
      return Promise.resolve(snapshot);
    },
    readCompaction: (input) => {
      assertReference(input);
      return Promise.resolve(compactions.at(-1));
    },
    commitCompaction: (input) => {
      assertReference(input);
      const record: SessionCompaction = {
        ...reference,
        revision: input.expectedRevision + 1,
        throughTurnId: input.throughTurnId,
        context: input.context,
      };
      compactions.push(record);
      return Promise.resolve(record);
    },
  };
  return { reference, port, completed, compactions };
}
