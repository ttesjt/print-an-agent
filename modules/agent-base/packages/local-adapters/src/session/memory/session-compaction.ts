import {
  AgentSessionError,
  completedLineageForBranch,
  type CommitSessionCompactionRequest,
  type SessionCompaction,
} from '@ta-agent/base-session';
import {
  createMemorySessionSnapshot,
  validateMemoryContext,
  readMemoryClock,
  touchMemorySession,
  cloneMemoryCompaction,
  type StoredMemorySession,
} from './session-state.js';

export function commitMemorySessionCompaction(
  session: StoredMemorySession,
  request: CommitSessionCompactionRequest,
  clock: () => number
): SessionCompaction {
  const current = session.compactions.get(request.branchId);
  const currentRevision = current?.revision ?? 0;
  if (request.expectedRevision !== currentRevision) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_CONFLICT',
      `Session compaction expected revision ${request.expectedRevision} but found ${currentRevision}.`
    );
  }
  const lineage = completedLineageForBranch(createMemorySessionSnapshot(session), request.branchId);
  const throughIndex = lineage.findIndex((turn) => turn.turnId === request.throughTurnId);
  if (throughIndex < 0) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Session compaction boundary must be a completed ancestor of its branch head.'
    );
  }
  if (current !== undefined) {
    const previousIndex = lineage.findIndex((turn) => turn.turnId === current.throughTurnId);
    if (previousIndex < 0 || throughIndex <= previousIndex) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_CONFLICT',
        'Session compaction boundary must advance the current branch projection.'
      );
    }
  }
  const committed = Object.freeze({
    agentId: session.agentId,
    sessionId: session.sessionId,
    branchId: request.branchId,
    revision: currentRevision + 1,
    throughTurnId: request.throughTurnId,
    context: validateMemoryContext(request.context),
  });
  const updatedAt = readMemoryClock(clock);
  session.compactions.set(request.branchId, committed);
  touchMemorySession(session, updatedAt);
  return cloneMemoryCompaction(committed);
}
