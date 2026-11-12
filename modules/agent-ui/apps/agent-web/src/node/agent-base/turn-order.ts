import {
  completedLineageForBranch,
  type CompletedSessionTurn,
  type FailedSessionTurn,
  type SessionBranchId,
  type SessionSnapshot,
  type TurnId,
} from '@print-an-agent/base-session';

type VisibleSessionTurn = CompletedSessionTurn | FailedSessionTurn;

export function visibleConversationTurns(
  snapshot: SessionSnapshot,
  branchId: SessionBranchId
): readonly VisibleSessionTurn[] {
  const lineage = completedLineageForBranch(snapshot, branchId);
  const ancestors = new Set(lineage.map((turn) => turn.turnId));
  const failures = new Map<TurnId | undefined, FailedSessionTurn[]>();
  for (const turn of snapshot.turns) {
    if (
      turn.status !== 'failed' ||
      turn.branchId !== branchId ||
      (turn.parentTurnId !== undefined && !ancestors.has(turn.parentTurnId))
    )
      continue;
    const siblings = failures.get(turn.parentTurnId) ?? [];
    siblings.push(turn);
    failures.set(turn.parentTurnId, siblings);
  }
  // Lineage owns completed order. Failed siblings retain adapter admission order, not clock order.
  const visible: VisibleSessionTurn[] = [...(failures.get(undefined) ?? [])];
  for (const turn of lineage) {
    visible.push(turn, ...(failures.get(turn.turnId) ?? []));
  }
  return visible;
}
