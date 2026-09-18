import { parseAgentId } from '@ta-agent/base-identity';
import {
  AgentSessionError,
  normalizeListSessionsInput,
  normalizeListSessionTurnsInput,
  parseSessionId,
  type ListSessionsInput,
  type ListSessionTurnsInput,
  type SessionInspection,
  type SessionListPage,
  type SessionReference,
  type SessionSummary,
  type SessionTurnPage,
} from '@ta-agent/base-session';

import { cloneMemoryTurn, memorySessionKey, type StoredMemorySession } from './session-state.js';

function summarize(session: StoredMemorySession): SessionSummary {
  return Object.freeze({
    agentId: session.agentId,
    sessionId: session.sessionId,
    ...(session.title === undefined ? {} : { title: session.title }),
    metadataRevision: session.metadataRevision,
    metadataUpdatedAt: session.metadataUpdatedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    selectedBranchId: session.selectedBranchId,
    navigationRevision: session.navigationRevision,
    branchCount: session.branches.size,
    turnCount: session.turns.length,
  });
}

export function listMemorySessions(
  sessions: ReadonlyMap<string, StoredMemorySession>,
  input: ListSessionsInput
): SessionListPage {
  const request = normalizeListSessionsInput(input);
  const ordered = [...sessions.values()]
    .filter((session) => session.agentId === request.agentId)
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.sessionId.localeCompare(right.sessionId)
    );
  const after = request.cursor;
  const filtered =
    after === undefined
      ? ordered
      : ordered.filter(
          (session) =>
            session.updatedAt < after.updatedAt ||
            (session.updatedAt === after.updatedAt &&
              session.sessionId.localeCompare(after.sessionId) > 0)
        );
  const selected = filtered.slice(0, request.limit + 1);
  const hasMore = selected.length > request.limit;
  const records = selected.slice(0, request.limit).map(summarize);
  const last = records.at(-1);
  return Object.freeze({
    records: Object.freeze(records),
    ...(hasMore && last !== undefined
      ? {
          nextCursor: Object.freeze({
            updatedAt: last.updatedAt,
            sessionId: last.sessionId,
          }),
        }
      : {}),
  });
}

export function inspectMemorySession(
  sessions: ReadonlyMap<string, StoredMemorySession>,
  reference: SessionReference
): SessionInspection | undefined {
  const agentId = parseAgentId(reference.agentId);
  const sessionId = parseSessionId(reference.sessionId);
  const session = sessions.get(memorySessionKey(agentId, sessionId));
  if (session === undefined) return undefined;
  return summarize(session);
}

export function listMemorySessionTurns(
  sessions: ReadonlyMap<string, StoredMemorySession>,
  input: ListSessionTurnsInput
): SessionTurnPage | undefined {
  const request = normalizeListSessionTurnsInput(input);
  const session = sessions.get(memorySessionKey(request.agentId, request.sessionId));
  if (session === undefined) return undefined;
  const newestFirst = [...session.turns].reverse();
  let start = 0;
  if (request.beforeTurnId !== undefined) {
    const cursorIndex = newestFirst.findIndex((turn) => turn.turnId === request.beforeTurnId);
    if (cursorIndex < 0) {
      throw new AgentSessionError(
        'TURN_NOT_FOUND',
        `Turn "${request.beforeTurnId}" does not exist in session "${request.sessionId}".`
      );
    }
    start = cursorIndex + 1;
  }
  const selected = newestFirst.slice(start, start + request.limit + 1);
  const hasMore = selected.length > request.limit;
  const records = selected.slice(0, request.limit).map(cloneMemoryTurn);
  const last = records.at(-1);
  return Object.freeze({
    records: Object.freeze(records),
    ...(hasMore && last !== undefined ? { nextCursor: last.turnId } : {}),
  });
}
