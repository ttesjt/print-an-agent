import { parseAgentId } from '@print-an-agent/base-identity';
import {
  AgentSessionError,
  normalizeListSessionsInput,
  normalizeListSessionTurnsInput,
  parseSessionId,
  type ListSessionsInput,
  type ListSessionTurnsInput,
  type SessionReference,
  type SessionTurnPage,
  type SessionLifecycleSummary,
  type SessionLifecycleListPage,
  type ListRetiredSessionsInput,
  type RetiredSessionListPage,
  normalizeListRetiredSessionsInput,
  defineSessionLifecycleSnapshot,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';

import {
  decodeTurn,
  normalizePersistedBranchId,
  requireNonNegativeInteger,
  requireString,
  optionalString,
  type SqliteRow,
} from './session-record-codec.js';
import { quoteSqliteIdentifier, type SqliteSessionTableNames } from './table-names.js';

const TURN_COLUMNS = `turn_id, status, user_message, assistant_message, failure_code,
  branch_id, parent_turn_id`;

function decodeSummary(row: SqliteRow): SessionLifecycleSummary {
  const title = optionalString(row, 'title');
  return Object.freeze({
    ...defineSessionLifecycleSnapshot({
      agentId: row.agent_id,
      sessionId: row.session_id,
      status: row.lifecycle_status,
      metadataRevision: row.metadata_revision,
      metadataUpdatedAt: row.metadata_updated_at,
      ...(row.retired_at === null ? {} : { retiredAt: row.retired_at }),
    }),
    agentId: parseAgentId(requireString(row, 'agent_id')),
    sessionId: parseSessionId(requireString(row, 'session_id')),
    ...(title === undefined ? {} : { title }),
    metadataRevision: requireNonNegativeInteger(row, 'metadata_revision'),
    metadataUpdatedAt: requireNonNegativeInteger(row, 'metadata_updated_at'),
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
): SessionLifecycleListPage {
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
              session.lifecycle_status, session.retired_at,
              session.title, session.metadata_revision, session.metadata_updated_at,
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
       WHERE session.agent_id = ? AND session.lifecycle_status = 'active' ${cursorFilter}
       ORDER BY session.updated_at DESC, session.session_id ASC
       LIMIT ?`
    )
    .all(...parameters) as SqliteRow[];
  const hasMore = rows.length > request.limit;
  const records = rows
    .slice(0, request.limit)
    .map((row) => Object.freeze({ ...decodeSummary(row), status: 'active' as const }));
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
): SessionLifecycleSummary | undefined {
  const reference = Object.freeze({
    agentId: parseAgentId(referenceInput.agentId),
    sessionId: parseSessionId(referenceInput.sessionId),
  });
  const row = database
    .prepare(
      `SELECT agent_id, session_id, created_at, updated_at, title, metadata_revision,
              lifecycle_status, retired_at,
              metadata_updated_at, selected_branch_id,
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

export function listRetiredSqliteSessions(
  db: DatabaseSync,
  input: ListRetiredSessionsInput,
  names: SqliteSessionTableNames
): RetiredSessionListPage {
  const request = normalizeListRetiredSessionsInput(input);
  const cursor = request.cursor;
  const rows = db
    .prepare(
      `SELECT session_id FROM ${quoteSqliteIdentifier(names.sessions)}
    WHERE agent_id = ? AND lifecycle_status = 'retired'
    ${cursor === undefined ? '' : 'AND (retired_at < ? OR (retired_at = ? AND session_id > ?))'}
    ORDER BY retired_at DESC, session_id ASC LIMIT ?`
    )
    .all(
      request.agentId,
      ...(cursor === undefined ? [] : [cursor.retiredAt, cursor.retiredAt, cursor.sessionId]),
      request.limit + 1
    );
  const records = rows.slice(0, request.limit).map((row) => {
    const summary = inspectSqliteSession(
      db,
      { agentId: request.agentId, sessionId: parseSessionId(row.session_id) },
      names
    );
    if (summary === undefined || summary.status !== 'retired')
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'Retired Session changed during query.'
      );
    return summary;
  });
  const last = records.at(-1);
  return Object.freeze({
    records: Object.freeze(records),
    ...(rows.length > request.limit && last !== undefined
      ? { nextCursor: Object.freeze({ retiredAt: last.retiredAt, sessionId: last.sessionId }) }
      : {}),
  });
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
