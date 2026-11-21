import {
  completedLineageBeforeTurn,
  type LoadSessionHistoryRequest,
  type SessionContextSnapshot,
} from '@print-an-agent/base-session';
import type { ModelMessage } from '@print-an-agent/model-invocation-core';
import { cloneMemoryCompaction, completedMemoryMessages } from './state/cloning.js';
import { cloneMemoryContext } from './state/context-message.js';
import { requireMemorySession, requireMemoryTurn } from './state/lookup.js';
import { createMemorySessionSnapshot } from './state/snapshot.js';
import type { MemorySessionState } from './types/state.js';

export function loadMemoryHistory(
  state: MemorySessionState,
  request: LoadSessionHistoryRequest
): Promise<readonly ModelMessage[]> {
  return Promise.resolve().then(() =>
    completedMemoryMessages(
      completedLineageBeforeTurn(
        createMemorySessionSnapshot(requireMemorySession(state.sessions, request)),
        request.beforeTurnId
      )
    )
  );
}

export function loadMemoryContext(
  state: MemorySessionState,
  request: LoadSessionHistoryRequest
): Promise<SessionContextSnapshot> {
  return Promise.resolve().then(() => {
    const session = requireMemorySession(state.sessions, request);
    const snapshot = createMemorySessionSnapshot(session);
    const beforeTurn = requireMemoryTurn(session, request.beforeTurnId);
    const lineage = completedLineageBeforeTurn(snapshot, request.beforeTurnId);
    const compaction = session.compactions.get(beforeTurn.branchId);
    const boundaryIndex =
      compaction === undefined
        ? -1
        : lineage.findIndex((turn) => turn.turnId === compaction.throughTurnId);
    const useCompaction = compaction !== undefined && boundaryIndex >= 0;
    return Object.freeze({
      agentId: session.agentId,
      sessionId: session.sessionId,
      branchId: beforeTurn.branchId,
      ...(useCompaction ? { compaction: cloneMemoryCompaction(compaction) } : {}),
      messages: Object.freeze([
        ...(useCompaction ? [cloneMemoryContext(compaction.context)] : []),
        ...completedMemoryMessages(lineage.slice(useCompaction ? boundaryIndex + 1 : 0)),
      ]),
    });
  });
}
