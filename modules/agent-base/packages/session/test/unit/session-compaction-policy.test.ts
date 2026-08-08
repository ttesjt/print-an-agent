import { defineAgentIdentity } from '@ta-agent/base-identity';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_COMPACTION_POLICY,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionId,
  parseTurnId,
  selectSessionCompactionSource,
  validateSessionCompactionPolicy,
  type CompletedSessionTurn,
  type SessionSnapshot,
} from '../../src/index.js';
import { assistantMessage, userMessage } from '../support/session-port-contract.js';

function completedTurn(index: number, text = String(index)): CompletedSessionTurn {
  return Object.freeze({
    status: 'completed',
    turnId: parseTurnId(`turn-${index}`),
    branchId: DEFAULT_SESSION_BRANCH_ID,
    ...(index === 1 ? {} : { parentTurnId: parseTurnId(`turn-${index - 1}`) }),
    userMessage: userMessage(`u${text}`, index * 2),
    assistantMessage: assistantMessage(`a${text}`, index * 2 + 1),
  });
}

function snapshot(turnCount: number): SessionSnapshot {
  const identity = defineAgentIdentity({ id: 'compaction-agent' });
  return Object.freeze({
    agentId: identity.id,
    sessionId: parseSessionId('compaction-session'),
    navigation: Object.freeze({
      agentId: identity.id,
      sessionId: parseSessionId('compaction-session'),
      revision: turnCount,
      selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      branches: Object.freeze([
        Object.freeze({
          branchId: DEFAULT_SESSION_BRANCH_ID,
          ...(turnCount === 0 ? {} : { headTurnId: parseTurnId(`turn-${turnCount}`) }),
          createdAt: 0,
        }),
      ]),
    }),
    turns: Object.freeze(
      Array.from({ length: turnCount }, (_unused, index) => completedTurn(index + 1))
    ),
  });
}

describe('Session compaction policy and source selection', () => {
  it('selects a bounded whole-turn prefix while retaining the configured recent tail', () => {
    const selection = selectSessionCompactionSource(
      snapshot(6),
      DEFAULT_SESSION_BRANCH_ID,
      undefined,
      DEFAULT_SESSION_COMPACTION_POLICY
    );

    expect(selection.status).toBe('selected');
    if (selection.status === 'selected') {
      expect(selection.source).toMatchObject({
        expectedRevision: 0,
        throughTurnId: parseTurnId('turn-4'),
      });
      expect(selection.source.turns.map((turn) => turn.turnId)).toEqual([
        parseTurnId('turn-1'),
        parseTurnId('turn-2'),
        parseTurnId('turn-3'),
        parseTurnId('turn-4'),
      ]);
    }
  });

  it('advances incrementally from an existing authoritative boundary', () => {
    const state = snapshot(8);
    const previous = Object.freeze({
      agentId: state.agentId,
      sessionId: state.sessionId,
      branchId: DEFAULT_SESSION_BRANCH_ID,
      revision: 2,
      throughTurnId: parseTurnId('turn-2'),
      context: Object.freeze({ role: 'context' as const, text: 'prior', timestamp: 20 }),
    });
    const selection = selectSessionCompactionSource(
      state,
      DEFAULT_SESSION_BRANCH_ID,
      previous,
      DEFAULT_SESSION_COMPACTION_POLICY
    );

    expect(selection).toMatchObject({
      status: 'selected',
      source: {
        expectedRevision: 2,
        previousContext: { text: 'prior' },
        throughTurnId: parseTurnId('turn-6'),
      },
    });
  });

  it('rejects contradictory policy and a first source turn above the character budget', () => {
    let invalidPolicy: unknown;
    try {
      validateSessionCompactionPolicy({
        ...DEFAULT_SESSION_COMPACTION_POLICY,
        minimumCompletedTurns: 2,
        retainRecentTurns: 2,
      });
    } catch (error: unknown) {
      invalidPolicy = error;
    }
    expect(invalidPolicy).toMatchObject({ code: 'SESSION_COMPACTION_INVALID' });

    let sourceLimit: unknown;
    try {
      selectSessionCompactionSource(snapshot(4), DEFAULT_SESSION_BRANCH_ID, undefined, {
        ...DEFAULT_SESSION_COMPACTION_POLICY,
        retainRecentTurns: 0,
        maxSourceCharacters: 1,
      });
    } catch (error: unknown) {
      sourceLimit = error;
    }
    expect(sourceLimit).toMatchObject({ code: 'SESSION_COMPACTION_SOURCE_LIMIT_EXCEEDED' });
  });
});
