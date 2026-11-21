import {
  completedLineageForBranch,
  type SessionBranchId,
  type SessionSnapshot,
  type TurnId,
} from '@print-an-agent/base-session';
import { cloneMemoryContext } from '../state/context-message.js';
import type { StoredMemorySession } from '../types/state.js';

export function inheritMemoryCompaction(
  session: StoredMemorySession,
  snapshot: SessionSnapshot,
  sourceBranchId: SessionBranchId,
  targetBranchId: SessionBranchId,
  throughTurnId: TurnId
): void {
  const source = session.compactions.get(sourceBranchId);
  if (source === undefined) return;
  const lineage = completedLineageForBranch(snapshot, sourceBranchId);
  const boundaryIndex = lineage.findIndex((turn) => turn.turnId === source.throughTurnId);
  const forkIndex = lineage.findIndex((turn) => turn.turnId === throughTurnId);
  if (boundaryIndex < 0 || forkIndex < boundaryIndex) return;
  session.compactions.set(
    targetBranchId,
    Object.freeze({
      ...source,
      branchId: targetBranchId,
      revision: 1,
      context: cloneMemoryContext(source.context),
    })
  );
}
