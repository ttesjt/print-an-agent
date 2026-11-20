// @vitest-environment node
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { defineAssistantModelMessage } from '@print-an-agent/model-invocation-core';
import {
  parseSessionBranchId,
  parseSessionId,
  parseTurnId,
  type CompletedSessionTurn,
  type FailedSessionTurn,
  type SessionSnapshot,
  type SessionTurn,
} from '@print-an-agent/base-session';
import { describe, expect, it } from 'vitest';
import { visibleConversationTurns } from '../../src/node/agent-base/turn-order.js';

const main = parseSessionBranchId('main');
const fork = parseSessionBranchId('fork');

function completed(id: string, timestamp: number, parent?: string): CompletedSessionTurn {
  return {
    branchId: main,
    status: 'completed',
    turnId: parseTurnId(id),
    ...(parent === undefined ? {} : { parentTurnId: parseTurnId(parent) }),
    userMessage: { role: 'user', text: id, timestamp },
    assistantMessage: defineAssistantModelMessage({
      role: 'assistant',
      text: id,
      timestamp,
      stopReason: 'stop',
      provenance: { kind: 'engine-defined', type: 'test.order', evidence: {} },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
    }),
  };
}

function failed(id: string, timestamp: number, parent?: string): FailedSessionTurn {
  return {
    branchId: main,
    status: 'failed',
    failureCode: 'TEST_FAILURE',
    turnId: parseTurnId(id),
    ...(parent === undefined ? {} : { parentTurnId: parseTurnId(parent) }),
    userMessage: { role: 'user', text: id, timestamp },
  };
}

function snapshot(turns: readonly SessionTurn[], head: string): SessionSnapshot {
  return {
    agentId: parseAgentId('order'),
    sessionId: parseSessionId('session'),
    navigation: {
      agentId: parseAgentId('order'),
      sessionId: parseSessionId('session'),
      revision: 1,
      selectedBranchId: main,
      branches: [
        { branchId: main, createdAt: 1000, headTurnId: parseTurnId(head) },
        {
          branchId: fork,
          parentBranchId: main,
          forkedFromTurnId: parseTurnId('z-parent'),
          createdAt: 1000,
          headTurnId: parseTurnId('z-parent'),
        },
      ],
    },
    turns,
  };
}

describe('conversation causal order', () => {
  it.each([1000, 500])(
    'does not reorder lineage for equal or regressing timestamps (%s)',
    (timestamp) => {
      const records = snapshot(
        [completed('z-parent', 1000), completed('a-child', timestamp, 'z-parent')],
        'a-child'
      );
      expect(visibleConversationTurns(records, main).map((turn) => turn.turnId)).toEqual([
        'z-parent',
        'a-child',
      ]);
    }
  );

  it('inserts failed siblings at their causal parent in admission order, excluding abandoned and foreign turns', () => {
    const records = snapshot(
      [
        failed('root-failure', 4000),
        completed('z-parent', 3000),
        failed('z-failure', 2500, 'z-parent'),
        failed('a-failure', 2000, 'z-parent'),
        completed('abandoned', 1500, 'z-parent'),
        failed('hidden-failure', 1250, 'abandoned'),
        completed('a-child', 1000, 'z-parent'),
        failed('last-failure', 500, 'a-child'),
        { ...failed('foreign-failure', 250, 'z-parent'), branchId: fork },
      ],
      'a-child'
    );
    expect(visibleConversationTurns(records, main).map((turn) => turn.turnId)).toEqual([
      'root-failure',
      'z-parent',
      'z-failure',
      'a-failure',
      'a-child',
      'last-failure',
    ]);
    expect(visibleConversationTurns(records, fork).map((turn) => turn.turnId)).toEqual([
      'z-parent',
      'foreign-failure',
    ]);
  });
});
