import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import type { SessionId } from '@print-an-agent/base-session';
import {
  AgentSessionError,
  type SessionBranchId,
  type SessionReference,
  type SessionTurn,
  type TurnId,
} from '@print-an-agent/base-session';
import type { StoredMemoryBranch, StoredMemorySession } from '../types/state.js';

export function memorySessionKey(agentId: AgentId, sessionId: SessionId): string {
  return `${agentId}\u0000${sessionId}`;
}

export function requireMemorySession(
  sessions: ReadonlyMap<string, StoredMemorySession>,
  reference: SessionReference
): StoredMemorySession {
  const session = sessions.get(memorySessionKey(reference.agentId, reference.sessionId));
  if (session === undefined) {
    throw new AgentSessionError(
      'SESSION_NOT_FOUND',
      `Session "${reference.sessionId}" does not exist for agent "${reference.agentId}".`
    );
  }
  return session;
}

export function requireMemoryBranch(
  session: StoredMemorySession,
  branchId: SessionBranchId
): StoredMemoryBranch {
  const branch = session.branches.get(branchId);
  if (branch === undefined) {
    throw new AgentSessionError(
      'SESSION_BRANCH_NOT_FOUND',
      `Session branch "${branchId}" does not exist in session "${session.sessionId}".`
    );
  }
  return branch;
}

export function requireMemoryTurn(session: StoredMemorySession, turnId: TurnId): SessionTurn {
  const turn = session.turns.find((candidate) => candidate.turnId === turnId);
  if (turn === undefined) {
    throw new AgentSessionError(
      'TURN_NOT_FOUND',
      `Turn "${turnId}" does not exist in session "${session.sessionId}".`
    );
  }
  return turn;
}

export function requireMemoryTurnIndex(session: StoredMemorySession, turnId: TurnId): number {
  const index = session.turns.findIndex((turn) => turn.turnId === turnId);
  if (index < 0) requireMemoryTurn(session, turnId);
  return index;
}
