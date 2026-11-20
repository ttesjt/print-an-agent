import type { SessionNavigationSnapshot, SessionSnapshot } from '../contracts/index.js';
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
