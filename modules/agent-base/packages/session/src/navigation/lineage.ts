import { AgentSessionError } from '../errors.js';
import type {
  CompletedSessionTurn,
  SessionBranchId,
  SessionBranchSnapshot,
  SessionNavigationSnapshot,
  SessionSnapshot,
  SessionTurn,
  TurnId,
} from '../types.js';

function turnMap(snapshot: SessionSnapshot): ReadonlyMap<TurnId, SessionTurn> {
  const turns = new Map<TurnId, SessionTurn>();
  for (const turn of snapshot.turns) {
    if (turns.has(turn.turnId)) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        `Session contains duplicate turn "${turn.turnId}".`
      );
    }
    turns.set(turn.turnId, turn);
  }
  return turns;
}

export function requireSessionBranch(
  snapshot: SessionSnapshot,
  branchId: SessionBranchId
): SessionBranchSnapshot {
  const branch = snapshot.navigation.branches.find((candidate) => candidate.branchId === branchId);
  if (branch === undefined) {
    throw new AgentSessionError(
      'SESSION_BRANCH_NOT_FOUND',
      `Session branch "${branchId}" does not exist in session "${snapshot.sessionId}".`
    );
  }
  return branch;
}

function walkCompletedLineage(
  snapshot: SessionSnapshot,
  startingTurnId: TurnId | undefined
): readonly CompletedSessionTurn[] {
  const turns = turnMap(snapshot);
  const visited = new Set<TurnId>();
  const lineage: CompletedSessionTurn[] = [];
  let turnId = startingTurnId;
  while (turnId !== undefined) {
    if (visited.has(turnId)) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'Session turn lineage contains a cycle.'
      );
    }
    visited.add(turnId);
    const turn = turns.get(turnId);
    if (turn === undefined || turn.status !== 'completed') {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'Session turn lineage must reference completed turns in the same Session.'
      );
    }
    lineage.push(turn);
    turnId = turn.parentTurnId;
  }
  lineage.reverse();
  return Object.freeze(lineage);
}

export function completedLineageForBranch(
  snapshot: SessionSnapshot,
  branchId: SessionBranchId
): readonly CompletedSessionTurn[] {
  return walkCompletedLineage(snapshot, requireSessionBranch(snapshot, branchId).headTurnId);
}

export function completedLineageBeforeTurn(
  snapshot: SessionSnapshot,
  beforeTurnId: TurnId
): readonly CompletedSessionTurn[] {
  const turn = turnMap(snapshot).get(beforeTurnId);
  if (turn === undefined) {
    throw new AgentSessionError(
      'TURN_NOT_FOUND',
      `Turn "${beforeTurnId}" does not exist in session "${snapshot.sessionId}".`
    );
  }
  return walkCompletedLineage(snapshot, turn.parentTurnId);
}

export function isCompletedAncestor(
  snapshot: SessionSnapshot,
  branchId: SessionBranchId,
  turnId: TurnId
): boolean {
  return completedLineageForBranch(snapshot, branchId).some((turn) => turn.turnId === turnId);
}

export function toSessionNavigationSnapshot(snapshot: SessionSnapshot): SessionNavigationSnapshot {
  return Object.freeze({
    agentId: snapshot.agentId,
    sessionId: snapshot.sessionId,
    revision: snapshot.navigation.revision,
    selectedBranchId: snapshot.navigation.selectedBranchId,
    branches: Object.freeze(
      snapshot.navigation.branches.map((branch) => Object.freeze({ ...branch }))
    ),
  });
}
