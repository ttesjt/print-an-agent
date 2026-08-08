import type { DatabaseSync } from 'node:sqlite';
import type { ModelMessage } from '@ta-agent/base-model';
import { AgentSessionError } from '../../errors.js';
import { parseSessionFailureCode } from '../../identifiers.js';
import { completedLineageBeforeTurn } from '../../navigation/lineage.js';
import type {
  ActiveSessionTurn,
  BeginSessionTurnRequest,
  CompleteSessionTurnRequest,
  CompletedSessionTurn,
  FailSessionTurnRequest,
  FailedSessionTurn,
  LoadSessionHistoryRequest,
  SessionTurn,
} from '../../types.js';
import { readClock, runImmediateTransaction } from './database.js';
import {
  decodeAssistantMessage,
  decodeUserMessage,
  encodeAssistantMessage,
  encodeUserMessage,
} from './message-codec.js';
import { loadSqliteSessionSnapshot } from './session-navigation-storage.js';
import {
  decodeTurn,
  requireNonNegativeInteger,
  requireSession,
  requireTurnRow,
  type SqliteRow,
} from './session-record-codec.js';

export function beginSqliteSessionTurn(
  database: DatabaseSync,
  request: BeginSessionTurnRequest,
  clock: () => number
): ActiveSessionTurn {
  const userMessageJson = encodeUserMessage(request.userMessage);
  const userMessage = decodeUserMessage(userMessageJson);
  return runImmediateTransaction(database, () => {
    const snapshot = loadSqliteSessionSnapshot(database, request);
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
        `SELECT 1 AS found FROM ta_agent_base_session_turns
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
        `SELECT 1 AS found FROM ta_agent_base_session_turns
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
    const session = requireSession(database, request);
    const sequence = requireNonNegativeInteger(session, 'next_turn_sequence');
    database
      .prepare(
        `INSERT INTO ta_agent_base_session_turns
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
        readClock(clock),
        request.branchId,
        branch.headTurnId ?? null
      );
    database
      .prepare(
        `UPDATE ta_agent_base_sessions
         SET next_turn_sequence = ?
         WHERE agent_id = ? AND session_id = ?`
      )
      .run(sequence + 1, request.agentId, request.sessionId);
    return Object.freeze({
      status: 'active',
      turnId: request.turnId,
      branchId: request.branchId,
      ...(branch.headTurnId === undefined ? {} : { parentTurnId: branch.headTurnId }),
      userMessage,
    });
  });
}

export function loadSqliteSessionHistory(
  database: DatabaseSync,
  request: LoadSessionHistoryRequest
): readonly ModelMessage[] {
  const lineage = completedLineageBeforeTurn(
    loadSqliteSessionSnapshot(database, request),
    request.beforeTurnId
  );
  return Object.freeze(
    lineage.flatMap<ModelMessage>((turn) => [turn.userMessage, turn.assistantMessage])
  );
}

export function completeSqliteSessionTurn(
  database: DatabaseSync,
  request: CompleteSessionTurnRequest,
  clock: () => number
): CompletedSessionTurn {
  const assistantMessageJson = encodeAssistantMessage(request.assistantMessage);
  const assistantMessage = decodeAssistantMessage(assistantMessageJson);
  return runImmediateTransaction(database, () => {
    const current = decodeTurn(requireTurnRow(database, request, request.turnId));
    if (current.status !== 'active') {
      throw new AgentSessionError(
        'TURN_STATE_INVALID',
        `Turn "${request.turnId}" cannot complete from state "${current.status}".`
      );
    }
    const head = database
      .prepare(
        `SELECT head_turn_id
         FROM ta_agent_base_session_branches
         WHERE agent_id = ? AND session_id = ? AND branch_id = ?`
      )
      .get(request.agentId, request.sessionId, current.branchId) as SqliteRow | undefined;
    if (head === undefined || head.head_turn_id !== (current.parentTurnId ?? null)) {
      throw new AgentSessionError(
        'SESSION_NAVIGATION_CONFLICT',
        'Session branch head changed before the active turn completed.'
      );
    }
    const result = database
      .prepare(
        `UPDATE ta_agent_base_session_turns
         SET status = 'completed', assistant_message = ?, finished_at = ?
         WHERE agent_id = ? AND session_id = ? AND turn_id = ? AND status = 'active'`
      )
      .run(
        assistantMessageJson,
        readClock(clock),
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
        `UPDATE ta_agent_base_session_branches
         SET head_turn_id = ?
         WHERE agent_id = ? AND session_id = ? AND branch_id = ?`
      )
      .run(request.turnId, request.agentId, request.sessionId, current.branchId);
    database
      .prepare(
        `UPDATE ta_agent_base_sessions
         SET navigation_revision = navigation_revision + 1
         WHERE agent_id = ? AND session_id = ?`
      )
      .run(request.agentId, request.sessionId);
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
  clock: () => number
): SessionTurn {
  const failureCode = parseSessionFailureCode(request.failureCode);
  return runImmediateTransaction(database, () => {
    const current = decodeTurn(requireTurnRow(database, request, request.turnId));
    if (current.status !== 'active') return current;
    const result = database
      .prepare(
        `UPDATE ta_agent_base_session_turns
         SET status = 'failed', failure_code = ?, finished_at = ?
         WHERE agent_id = ? AND session_id = ? AND turn_id = ? AND status = 'active'`
      )
      .run(failureCode, readClock(clock), request.agentId, request.sessionId, request.turnId);
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
    return failed;
  });
}
