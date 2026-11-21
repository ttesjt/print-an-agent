import {
  AgentSessionError,
  defineSessionTurnPresentation,
  parseSessionFailureCode,
  type ActiveSessionTurn,
  type BeginSessionTurnRequest,
  type CompleteSessionTurnRequest,
  type CompletedSessionTurn,
  type FailSessionTurnRequest,
  type FailedSessionTurn,
  type SessionTurn,
  type SessionTurnPresentation,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { requireNonNegativeInteger } from '../codecs/columns.js';
import {
  decodeAssistantMessage,
  decodeUserMessage,
  encodeAssistantMessage,
  encodeUserMessage,
} from '../codecs/message.js';
import { decodeTurn } from '../codecs/turn.js';
import { readClock, runImmediateTransaction } from '../database.js';
import { requireSession, requireTurnRow } from '../records.js';
import { loadSqliteSessionSnapshot } from '../snapshot.js';
import { quoteSqliteIdentifier } from '../table-names.js';
import type { SqliteRow } from '../types/record.js';
import type { SqliteSessionTableNames } from '../types/table-names.js';

export function beginSqliteSessionTurn(
  database: DatabaseSync,
  request: BeginSessionTurnRequest,
  clock: () => number,
  tableNames: SqliteSessionTableNames
): ActiveSessionTurn {
  const userMessageJson = encodeUserMessage(request.userMessage);
  const userMessage = decodeUserMessage(userMessageJson);
  return runImmediateTransaction(database, () => {
    const snapshot = loadSqliteSessionSnapshot(database, request, tableNames);
    if (
      request.navigationRevision !== snapshot.navigation.revision ||
      request.branchId !== snapshot.navigation.selectedBranchId
    ) {
      throw new AgentSessionError(
        'SESSION_NAVIGATION_CONFLICT',
        'Session selection changed before the request turn began.'
      );
    }
    const duplicate = database
      .prepare(
        `SELECT 1 AS found FROM ${quoteSqliteIdentifier(tableNames.turns)}
         WHERE agent_id = ? AND session_id = ? AND turn_id = ?`
      )
      .get(request.agentId, request.sessionId, request.turnId);
    if (duplicate !== undefined) {
      throw new AgentSessionError(
        'TURN_ALREADY_EXISTS',
        `Turn "${request.turnId}" already exists in session "${request.sessionId}".`
      );
    }
    const active = database
      .prepare(
        `SELECT 1 AS found FROM ${quoteSqliteIdentifier(tableNames.turns)}
         WHERE agent_id = ? AND session_id = ? AND branch_id = ? AND status = 'active'`
      )
      .get(request.agentId, request.sessionId, request.branchId);
    if (active !== undefined) {
      throw new AgentSessionError(
        'SESSION_BRANCH_BUSY',
        `Session branch "${request.branchId}" already has an active turn.`
      );
    }
    const branch = snapshot.navigation.branches.find(
      (candidate) => candidate.branchId === request.branchId
    );
    if (branch === undefined) {
      throw new AgentSessionError(
        'SESSION_BRANCH_NOT_FOUND',
        `Session branch "${request.branchId}" does not exist.`
      );
    }
    const session = requireSession(database, request, tableNames);
    const sequence = requireNonNegativeInteger(session, 'next_turn_sequence');
    const startedAt = readClock(clock);
    database
      .prepare(
        `INSERT INTO ${quoteSqliteIdentifier(tableNames.turns)}
          (agent_id, session_id, turn_id, turn_sequence, status, user_message, started_at,
           branch_id, parent_turn_id)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
      )
      .run(
        request.agentId,
        request.sessionId,
        request.turnId,
        sequence,
        userMessageJson,
        startedAt,
        request.branchId,
        branch.headTurnId ?? null
      );
    database
      .prepare(
        `UPDATE ${quoteSqliteIdentifier(tableNames.sessions)}
         SET next_turn_sequence = ?, updated_at = MAX(updated_at, ?)
         WHERE agent_id = ? AND session_id = ?`
      )
      .run(sequence + 1, startedAt, request.agentId, request.sessionId);
    return Object.freeze({
      status: 'active',
      turnId: request.turnId,
      branchId: request.branchId,
      ...(branch.headTurnId === undefined ? {} : { parentTurnId: branch.headTurnId }),
      userMessage,
    });
  });
}

export function completeSqliteSessionTurn(
  database: DatabaseSync,
  request: CompleteSessionTurnRequest,
  clock: () => number,
  tableNames: SqliteSessionTableNames,
  presentation?: SessionTurnPresentation
): CompletedSessionTurn {
  const presentationJson =
    presentation === undefined ? null : JSON.stringify(defineSessionTurnPresentation(presentation));
  const assistantMessageJson = encodeAssistantMessage(request.assistantMessage);
  const assistantMessage = decodeAssistantMessage(assistantMessageJson);
  return runImmediateTransaction(database, () => {
    const current = decodeTurn(requireTurnRow(database, request, request.turnId, tableNames));
    if (current.status !== 'active') {
      throw new AgentSessionError(
        'TURN_STATE_INVALID',
        `Turn "${request.turnId}" cannot complete from state "${current.status}".`
      );
    }
    const head = database
      .prepare(
        `SELECT head_turn_id
         FROM ${quoteSqliteIdentifier(tableNames.branches)}
         WHERE agent_id = ? AND session_id = ? AND branch_id = ?`
      )
      .get(request.agentId, request.sessionId, current.branchId) as SqliteRow | undefined;
    if (head === undefined || head.head_turn_id !== (current.parentTurnId ?? null)) {
      throw new AgentSessionError(
        'SESSION_NAVIGATION_CONFLICT',
        'Session branch head changed before the active turn completed.'
      );
    }
    const finishedAt = readClock(clock);
    const result = database
      .prepare(
        `UPDATE ${quoteSqliteIdentifier(tableNames.turns)}
         SET status = 'completed', assistant_message = ?, finished_at = ?, presentation = ?
         WHERE agent_id = ? AND session_id = ? AND turn_id = ? AND status = 'active'`
      )
      .run(
        assistantMessageJson,
        finishedAt,
        presentationJson,
        request.agentId,
        request.sessionId,
        request.turnId
      );
    if (result.changes !== 1) {
      throw new AgentSessionError(
        'TURN_STATE_INVALID',
        `Turn "${request.turnId}" was not active when completion was committed.`
      );
    }
    database
      .prepare(
        `UPDATE ${quoteSqliteIdentifier(tableNames.branches)}
         SET head_turn_id = ?
         WHERE agent_id = ? AND session_id = ? AND branch_id = ?`
      )
      .run(request.turnId, request.agentId, request.sessionId, current.branchId);
    database
      .prepare(
        `UPDATE ${quoteSqliteIdentifier(tableNames.sessions)}
         SET navigation_revision = navigation_revision + 1,
             updated_at = MAX(updated_at, ?)
         WHERE agent_id = ? AND session_id = ?`
      )
      .run(finishedAt, request.agentId, request.sessionId);
    return Object.freeze({
      status: 'completed',
      turnId: request.turnId,
      branchId: current.branchId,
      ...(current.parentTurnId === undefined ? {} : { parentTurnId: current.parentTurnId }),
      userMessage: current.userMessage,
      assistantMessage,
    });
  });
}

export function failSqliteSessionTurn(
  database: DatabaseSync,
  request: FailSessionTurnRequest,
  clock: () => number,
  tableNames: SqliteSessionTableNames
): SessionTurn {
  const failureCode = parseSessionFailureCode(request.failureCode);
  return runImmediateTransaction(database, () => {
    const current = decodeTurn(requireTurnRow(database, request, request.turnId, tableNames));
    if (current.status !== 'active') return current;
    const finishedAt = readClock(clock);
    const result = database
      .prepare(
        `UPDATE ${quoteSqliteIdentifier(tableNames.turns)}
         SET status = 'failed', failure_code = ?, finished_at = ?
         WHERE agent_id = ? AND session_id = ? AND turn_id = ? AND status = 'active'`
      )
      .run(failureCode, finishedAt, request.agentId, request.sessionId, request.turnId);
    if (result.changes !== 1) {
      throw new AgentSessionError(
        'TURN_STATE_INVALID',
        `Turn "${request.turnId}" was not active when failure was committed.`
      );
    }
    const failed: FailedSessionTurn = Object.freeze({
      status: 'failed',
      turnId: request.turnId,
      branchId: current.branchId,
      ...(current.parentTurnId === undefined ? {} : { parentTurnId: current.parentTurnId }),
      userMessage: current.userMessage,
      failureCode,
    });
    database
      .prepare(
        `UPDATE ${quoteSqliteIdentifier(tableNames.sessions)}
         SET updated_at = MAX(updated_at, ?)
         WHERE agent_id = ? AND session_id = ?`
      )
      .run(finishedAt, request.agentId, request.sessionId);
    return failed;
  });
}
