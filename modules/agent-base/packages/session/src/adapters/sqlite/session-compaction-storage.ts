import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { ModelMessage } from '@ta-agent/base-model';
import type {
  CommitSessionCompactionRequest,
  SessionCompaction,
  SessionContextSnapshot,
} from '../../compaction/contracts.js';
import { AgentSessionError } from '../../errors.js';
import { parseTurnId } from '../../identifiers.js';
import type { LoadSessionHistoryRequest, SessionReference, TurnId } from '../../types.js';
import { runImmediateTransaction } from './database.js';
import {
  decodeAssistantMessage,
  decodeContextMessage,
  decodeUserMessage,
  encodeContextMessage,
} from './message-codec.js';

type SqliteRow = Record<string, SQLOutputValue>;

function requireString(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      `SQLite Session compaction column "${column}" must be a string.`
    );
  }
  return value;
}

function requireNonNegativeInteger(row: SqliteRow, column: string, label: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      `${label} column "${column}" must be a non-negative safe integer.`
    );
  }
  return value;
}

function requirePositiveInteger(row: SqliteRow, column: string, label: string): number {
  const value = requireNonNegativeInteger(row, column, label);
  if (value === 0) {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      `${label} column "${column}" must be positive.`
    );
  }
  return value;
}

function normalizeCompactionTurnId(row: SqliteRow): TurnId {
  try {
    return parseTurnId(requireString(row, 'through_turn_id'));
  } catch (cause: unknown) {
    if (cause instanceof AgentSessionError && cause.code === 'SESSION_RECORD_INVALID') throw cause;
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      'SQLite Session compaction contains an invalid boundary turn ID.',
      { cause }
    );
  }
}

function decodeCompaction(reference: SessionReference, row: SqliteRow): SessionCompaction {
  if (requireString(row, 'status') !== 'completed') {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      'SQLite Session compaction boundary must identify a completed turn.'
    );
  }
  return Object.freeze({
    ...reference,
    revision: requirePositiveInteger(row, 'revision', 'SQLite Session compaction'),
    throughTurnId: normalizeCompactionTurnId(row),
    context: decodeContextMessage(requireString(row, 'context_message')),
  });
}

function requireSession(database: DatabaseSync, reference: SessionReference): void {
  const row = database
    .prepare('SELECT 1 AS found FROM ta_agent_base_sessions WHERE agent_id = ? AND session_id = ?')
    .get(reference.agentId, reference.sessionId);
  if (row === undefined) {
    throw new AgentSessionError(
      'SESSION_NOT_FOUND',
      `Session "${reference.sessionId}" does not exist for agent "${reference.agentId}".`
    );
  }
}

function decodeCompletedMessages(rows: readonly SqliteRow[]): ModelMessage[] {
  return rows.flatMap<ModelMessage>((row) => [
    decodeUserMessage(requireString(row, 'user_message')),
    decodeAssistantMessage(requireString(row, 'assistant_message')),
  ]);
}

export function loadSqliteSessionContext(
  database: DatabaseSync,
  request: LoadSessionHistoryRequest
): SessionContextSnapshot {
  requireSession(database, request);
  const boundary = database
    .prepare(
      `SELECT turn_sequence
       FROM ta_agent_base_session_turns
       WHERE agent_id = ? AND session_id = ? AND turn_id = ?`
    )
    .get(request.agentId, request.sessionId, request.beforeTurnId) as SqliteRow | undefined;
  if (boundary === undefined) {
    throw new AgentSessionError(
      'TURN_NOT_FOUND',
      `Turn "${request.beforeTurnId}" does not exist in session "${request.sessionId}".`
    );
  }
  const beforeSequence = requireNonNegativeInteger(
    boundary,
    'turn_sequence',
    'SQLite Session context boundary'
  );
  const compactionRow = database
    .prepare(
      `SELECT c.revision, c.through_turn_id, c.context_message, t.turn_sequence, t.status
       FROM ta_agent_base_session_compactions c
       LEFT JOIN ta_agent_base_session_turns t
         ON t.agent_id = c.agent_id
        AND t.session_id = c.session_id
        AND t.turn_id = c.through_turn_id
       WHERE c.agent_id = ? AND c.session_id = ?`
    )
    .get(request.agentId, request.sessionId) as SqliteRow | undefined;
  const throughSequence =
    compactionRow === undefined
      ? undefined
      : requireNonNegativeInteger(
          compactionRow,
          'turn_sequence',
          'SQLite Session compaction boundary'
        );
  const useCompaction =
    compactionRow !== undefined &&
    throughSequence !== undefined &&
    throughSequence < beforeSequence;
  const rows = database
    .prepare(
      `SELECT user_message, assistant_message
       FROM ta_agent_base_session_turns
       WHERE agent_id = ? AND session_id = ?
         AND turn_sequence > ? AND turn_sequence < ? AND status = 'completed'
       ORDER BY turn_sequence ASC`
    )
    .all(
      request.agentId,
      request.sessionId,
      useCompaction ? throughSequence : -1,
      beforeSequence
    ) as SqliteRow[];
  const compaction = useCompaction ? decodeCompaction(request, compactionRow) : undefined;
  return Object.freeze({
    agentId: request.agentId,
    sessionId: request.sessionId,
    ...(compaction === undefined ? {} : { compaction }),
    messages: Object.freeze([
      ...(compaction === undefined ? [] : [compaction.context]),
      ...decodeCompletedMessages(rows),
    ]),
  });
}

export function readSqliteSessionCompaction(
  database: DatabaseSync,
  reference: SessionReference
): SessionCompaction | undefined {
  requireSession(database, reference);
  const row = database
    .prepare(
      `SELECT c.revision, c.through_turn_id, c.context_message, t.status
       FROM ta_agent_base_session_compactions c
       LEFT JOIN ta_agent_base_session_turns t
         ON t.agent_id = c.agent_id
        AND t.session_id = c.session_id
        AND t.turn_id = c.through_turn_id
       WHERE c.agent_id = ? AND c.session_id = ?`
    )
    .get(reference.agentId, reference.sessionId) as SqliteRow | undefined;
  return row === undefined ? undefined : decodeCompaction(reference, row);
}

interface CurrentCompactionState {
  readonly exists: boolean;
  readonly revision: number;
  readonly throughSequence?: number;
}

function readCompletedBoundarySequence(
  database: DatabaseSync,
  request: SessionReference,
  throughTurnId: TurnId
): number {
  const boundary = database
    .prepare(
      `SELECT status, turn_sequence
       FROM ta_agent_base_session_turns
       WHERE agent_id = ? AND session_id = ? AND turn_id = ?`
    )
    .get(request.agentId, request.sessionId, throughTurnId) as SqliteRow | undefined;
  if (boundary === undefined) {
    throw new AgentSessionError(
      'TURN_NOT_FOUND',
      `Turn "${throughTurnId}" does not exist in session "${request.sessionId}".`
    );
  }
  if (boundary.status !== 'completed') {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Session compaction boundary must identify a completed turn.'
    );
  }
  return requireNonNegativeInteger(boundary, 'turn_sequence', 'SQLite Session compaction boundary');
}

function readCurrentCompactionState(
  database: DatabaseSync,
  reference: SessionReference
): CurrentCompactionState {
  const row = database
    .prepare(
      `SELECT c.revision, t.turn_sequence
       FROM ta_agent_base_session_compactions c
       JOIN ta_agent_base_session_turns t
         ON t.agent_id = c.agent_id
        AND t.session_id = c.session_id
        AND t.turn_id = c.through_turn_id
       WHERE c.agent_id = ? AND c.session_id = ?`
    )
    .get(reference.agentId, reference.sessionId) as SqliteRow | undefined;
  if (row === undefined) return Object.freeze({ exists: false, revision: 0 });
  return Object.freeze({
    exists: true,
    revision: requirePositiveInteger(row, 'revision', 'SQLite Session compaction'),
    throughSequence: requireNonNegativeInteger(
      row,
      'turn_sequence',
      'SQLite Session compaction boundary'
    ),
  });
}

function assertCompactionCommitAuthority(
  request: CommitSessionCompactionRequest,
  state: CurrentCompactionState,
  throughSequence: number
): void {
  if (request.expectedRevision !== state.revision) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_CONFLICT',
      `Session compaction expected revision ${request.expectedRevision} but found ${state.revision}.`
    );
  }
  if (state.throughSequence !== undefined && throughSequence <= state.throughSequence) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_CONFLICT',
      'Session compaction boundary must advance the current projection.'
    );
  }
}

function writeCompaction(
  database: DatabaseSync,
  request: CommitSessionCompactionRequest,
  state: CurrentCompactionState,
  throughTurnId: TurnId,
  contextMessage: string,
  revision: number
): void {
  if (!state.exists) {
    database
      .prepare(
        `INSERT INTO ta_agent_base_session_compactions
          (agent_id, session_id, revision, through_turn_id, context_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        request.agentId,
        request.sessionId,
        revision,
        throughTurnId,
        contextMessage,
        request.context.timestamp
      );
    return;
  }
  const result = database
    .prepare(
      `UPDATE ta_agent_base_session_compactions
       SET revision = ?, through_turn_id = ?, context_message = ?, created_at = ?
       WHERE agent_id = ? AND session_id = ? AND revision = ?`
    )
    .run(
      revision,
      throughTurnId,
      contextMessage,
      request.context.timestamp,
      request.agentId,
      request.sessionId,
      request.expectedRevision
    );
  if (result.changes !== 1) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_CONFLICT',
      'Session compaction revision changed before commit.'
    );
  }
}

export function commitSqliteSessionCompaction(
  database: DatabaseSync,
  request: CommitSessionCompactionRequest
): SessionCompaction {
  const throughTurnId = parseTurnId(request.throughTurnId);
  const contextMessage = encodeContextMessage(request.context);
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Session compaction expected revision must be a non-negative safe integer.'
    );
  }
  return runImmediateTransaction(database, () => {
    requireSession(database, request);
    const throughSequence = readCompletedBoundarySequence(database, request, throughTurnId);
    const state = readCurrentCompactionState(database, request);
    assertCompactionCommitAuthority(request, state, throughSequence);
    const revision = state.revision + 1;
    writeCompaction(database, request, state, throughTurnId, contextMessage, revision);
    return Object.freeze({
      agentId: request.agentId,
      sessionId: request.sessionId,
      revision,
      throughTurnId,
      context: decodeContextMessage(contextMessage),
    });
  });
}
