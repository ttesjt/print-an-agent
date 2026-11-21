import type {
  ResolvedSessionReference,
  SessionBranchSnapshot,
  SessionSnapshot,
} from '@print-an-agent/base-session';
import type { StoredMemoryBranch, StoredMemorySession } from '../types/state.js';
import { cloneMemoryTurn } from './cloning.js';

function cloneMemoryBranch(branch: StoredMemoryBranch): SessionBranchSnapshot {
  return Object.freeze({ ...branch });
}

export function createMemorySessionSnapshot(session: StoredMemorySession): SessionSnapshot {
  return Object.freeze({
    agentId: session.agentId,
    sessionId: session.sessionId,
    navigation: Object.freeze({
      agentId: session.agentId,
      sessionId: session.sessionId,
      revision: session.navigationRevision,
      selectedBranchId: session.selectedBranchId,
      branches: Object.freeze([...session.branches.values()].map(cloneMemoryBranch)),
    }),
    turns: Object.freeze(session.turns.map(cloneMemoryTurn)),
  });
}

export function resolveMemorySessionReference(
  session: StoredMemorySession
): ResolvedSessionReference {
  return Object.freeze({
    agentId: session.agentId,
    sessionId: session.sessionId,
    branchId: session.selectedBranchId,
    navigationRevision: session.navigationRevision,
  });
}
