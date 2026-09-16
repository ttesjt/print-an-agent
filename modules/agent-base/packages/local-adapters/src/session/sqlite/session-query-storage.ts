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
import type { DatabaseSync } from 'node:sqlite';

import {
  decodeTurn,
  normalizePersistedBranchId,
  requireNonNegativeInteger,
  requireString,
  type SqliteRow,
} from './session-record-codec.js';
import { quoteSqliteIdentifier, type SqliteSessionTableNames } from './table-names.js';

const TURN_COLUMNS = `turn_id, status, user_message, assistant_message, failure_code,
  branch_id, parent_turn_id`;

function decodeSummary(row: SqliteRow): SessionSummary {
  return Object.freeze({
    agentId: parseAgentId(requireString(row, 'agent_id')),
    sessionId: parseSessionId(requireString(row, 'session_id')),
    createdAt: requireNonNegativeInteger(row, 'created_at'),
    updatedAt: requireNonNegativeInteger(row, 'updated_at'),
    selectedBranchId: normalizePersistedBranchId(
      requireString(row, 'selected_branch_id'),
      'SQLite Session selected branch ID'
    ),
    navigationRevision: requireNonNegativeInteger(row, 'navigation_revision'),
    branchCount: requireNonNegativeInteger(row, 'branch_count'),
    turnCount: requireNonNegativeInteger(row, 'turn_count'),
  });
}

export function listSqliteSessions(
  database: DatabaseSync,
  input: ListSessionsInput,
  tableNames: SqliteSessionTableNames
): SessionListPage {
  const request = normalizeListSessionsInput(input);
  const cursorFilter =
    request.cursor === undefined
      ? ''
      : `AND (session.updated_at < ? OR
              (session.updated_at = ? AND session.session_id > ?))`;
  const parameters: Array<string | number> = [request.agentId];
  if (request.cursor !== undefined) {
    parameters.push(request.cursor.updatedAt, request.cursor.updatedAt, request.cursor.sessionId);
  }
  parameters.push(request.limit + 1);
  const rows = database
    .prepare(
      `SELECT session.agent_id, session.session_id, session.created_at, session.updated_at,
              session.selected_branch_id, session.navigation_revision,
              (SELECT COUNT(*)
               FROM ${quoteSqliteIdentifier(tableNames.branches)} AS branch
               WHERE branch.agent_id = session.agent_id
                 AND branch.session_id = session.session_id) AS branch_count,
              (SELECT COUNT(*)
               FROM ${quoteSqliteIdentifier(tableNames.turns)} AS turn
               WHERE turn.agent_id = session.agent_id
                 AND turn.session_id = session.session_id) AS turn_count
       FROM ${quoteSqliteIdentifier(tableNames.sessions)} AS session
       WHERE session.agent_id = ? ${cursorFilter}
       ORDER BY session.updated_at DESC, session.session_id ASC
       LIMIT ?`
    )
    .all(...parameters) as SqliteRow[];
  const hasMore = rows.length > request.limit;
  const records = rows.slice(0, request.limit).map(decodeSummary);
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

export function inspectSqliteSession(
  database: DatabaseSync,
  referenceInput: SessionReference,
  tableNames: SqliteSessionTableNames
): SessionInspection | undefined {
  const reference = Object.freeze({
    agentId: parseAgentId(referenceInput.agentId),
    sessionId: parseSessionId(referenceInput.sessionId),
  });
  const row = database
    .prepare(
      `SELECT agent_id, session_id, created_at, updated_at, selected_branch_id,
              navigation_revision,
              (SELECT COUNT(*)
               FROM ${quoteSqliteIdentifier(tableNames.branches)} AS branch
               WHERE branch.agent_id = session.agent_id
                 AND branch.session_id = session.session_id) AS branch_count,
              (SELECT COUNT(*)
               FROM ${quoteSqliteIdentifier(tableNames.turns)} AS turn
               WHERE turn.agent_id = session.agent_id
                 AND turn.session_id = session.session_id) AS turn_count
       FROM ${quoteSqliteIdentifier(tableNames.sessions)} AS session
       WHERE agent_id = ? AND session_id = ?`
    )
    .get(reference.agentId, reference.sessionId) as SqliteRow | undefined;
  if (row === undefined) return undefined;
  return decodeSummary(row);
}

export function listSqliteSessionTurns(
  database: DatabaseSync,
  input: ListSessionTurnsInput,
  tableNames: SqliteSessionTableNames
): SessionTurnPage | undefined {
  const request = normalizeListSessionTurnsInput(input);
  const session = database
    .prepare(
      `SELECT 1 AS found FROM ${quoteSqliteIdentifier(tableNames.sessions)}
       WHERE agent_id = ? AND session_id = ?`
    )
    .get(request.agentId, request.sessionId);
  if (session === undefined) return undefined;
  let beforeSequence: number | undefined;
  if (request.beforeTurnId !== undefined) {
    const cursor = database
      .prepare(
        `SELECT turn_sequence FROM ${quoteSqliteIdentifier(tableNames.turns)}
         WHERE agent_id = ? AND session_id = ? AND turn_id = ?`
      )
      .get(request.agentId, request.sessionId, request.beforeTurnId) as SqliteRow | undefined;
    if (cursor === undefined) {
      throw new AgentSessionError(
        'TURN_NOT_FOUND',
        `Turn "${request.beforeTurnId}" does not exist in session "${request.sessionId}".`
      );
    }
    beforeSequence = requireNonNegativeInteger(cursor, 'turn_sequence');
  }
  const rows = database
    .prepare(
      `SELECT ${TURN_COLUMNS}
       FROM ${quoteSqliteIdentifier(tableNames.turns)}
       WHERE agent_id = ? AND session_id = ?
         ${beforeSequence === undefined ? '' : 'AND turn_sequence < ?'}
       ORDER BY turn_sequence DESC
       LIMIT ?`
    )
    .all(
      request.agentId,
      request.sessionId,
      ...(beforeSequence === undefined ? [] : [beforeSequence]),
      request.limit + 1
    ) as SqliteRow[];
  const hasMore = rows.length > request.limit;
  const records = rows.slice(0, request.limit).map(decodeTurn);
  const last = records.at(-1);
  return Object.freeze({
    records: Object.freeze(records),
    ...(hasMore && last !== undefined ? { nextCursor: last.turnId } : {}),
  });
}
