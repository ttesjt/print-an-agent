import {
  AgentSessionError,
  type SessionExecutionFence,
  type SessionLifecycleSnapshot,
} from '@print-an-agent/base-session';
import type { StoredMemorySession } from '../types/state.js';

export function memoryLifecycleSnapshot(session: StoredMemorySession): SessionLifecycleSnapshot {
  return Object.freeze({
    agentId: session.agentId,
    sessionId: session.sessionId,
    metadataRevision: session.metadataRevision,
    metadataUpdatedAt: session.metadataUpdatedAt,
    ...session.lifecycle,
  });
}

export function memoryExecutionFence(session: StoredMemorySession): SessionExecutionFence {
  return Object.freeze({
    revision: session.executionRevision,
    state: session.executionState,
    activeLeaseCount: session.executions.size,
    pendingWorkCount:
      session.turns.filter((turn) => turn.status === 'active').length +
      [...session.memoryRecords.values()].filter((record) => !record.settled).length,
  });
}

export function advanceMemoryExecution(session: StoredMemorySession): void {
  if (session.executionRevision >= Number.MAX_SAFE_INTEGER) {
    throw new AgentSessionError(
      'SESSION_EXECUTION_INVALID',
      'Session execution revision exhausted.'
    );
  }
  session.executionRevision += 1;
}
