import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  AgentSessionError,
  normalizeListSessionsInput,
  normalizeListSessionTurnsInput,
  parseSessionId,
  type ListSessionsInput,
  type ListSessionTurnsInput,
  type SessionLifecycleSummary,
  type SessionLifecycleListPage,
  type ListRetiredSessionsInput,
  type RetiredSessionListPage,
  normalizeListRetiredSessionsInput,
  type SessionReference,
  type SessionTurnPage,
} from '@print-an-agent/base-session';

import { cloneMemoryTurn, memorySessionKey, type StoredMemorySession } from './session-state.js';

function summarize(session: StoredMemorySession): SessionLifecycleSummary {
  return Object.freeze({
    ...session.lifecycle,
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
): SessionLifecycleListPage {
  const request = normalizeListSessionsInput(input);
  const ordered = [...sessions.values()]
    .filter(
      (session) => session.agentId === request.agentId && session.lifecycle.status === 'active'
    )
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
  const records = selected
    .slice(0, request.limit)
    .map((session) => Object.freeze({ ...summarize(session), status: 'active' as const }));
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
): SessionLifecycleSummary | undefined {
  const agentId = parseAgentId(reference.agentId);
  const sessionId = parseSessionId(reference.sessionId);
  const session = sessions.get(memorySessionKey(agentId, sessionId));
  if (session === undefined) return undefined;
  return summarize(session);
}

export function listRetiredMemorySessions(
  sessions: ReadonlyMap<string, StoredMemorySession>,
  input: ListRetiredSessionsInput
): RetiredSessionListPage {
  const request = normalizeListRetiredSessionsInput(input);
  const cursor = request.cursor;
  const selected = [...sessions.values()]
    .flatMap((session) => {
      if (session.agentId !== request.agentId || session.lifecycle.status !== 'retired') return [];
      return [Object.freeze({ ...summarize(session), ...session.lifecycle })];
    })
    .sort(
      (a, b) =>
        b.retiredAt - a.retiredAt ||
        (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0)
    )
    .filter(
      (session) =>
        cursor === undefined ||
        session.retiredAt < cursor.retiredAt ||
        (session.retiredAt === cursor.retiredAt && session.sessionId > cursor.sessionId)
    )
    .slice(0, request.limit + 1);
  const records = selected.slice(0, request.limit);
  const last = records.at(-1);
  return Object.freeze({
    records: Object.freeze(records),
    ...(selected.length > request.limit && last !== undefined
      ? { nextCursor: Object.freeze({ retiredAt: last.retiredAt, sessionId: last.sessionId }) }
      : {}),
  });
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
