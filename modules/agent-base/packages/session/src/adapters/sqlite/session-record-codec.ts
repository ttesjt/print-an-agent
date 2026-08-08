import { parseAgentId } from '@ta-agent/base-identity';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { AgentSessionError } from '../../errors.js';
import {
  parseSessionBranchId,
  parseSessionFailureCode,
  parseSessionId,
  parseTurnId,
} from '../../identifiers.js';
import type { SessionBranchSnapshot, SessionReference, SessionTurn, TurnId } from '../../types.js';
import { decodeAssistantMessage, decodeUserMessage } from './message-codec.js';

export type SqliteRow = Record<string, SQLOutputValue>;

export function requireString(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      `SQLite Session column "${column}" must be a string.`
    );
  }
  return value;
}

export function optionalString(row: SqliteRow, column: string): string | undefined {
  const value = row[column];
  if (value === null) return undefined;
  return requireString(row, column);
}

export function requireNonNegativeInteger(
  row: SqliteRow,
  column: string,
  label = 'SQLite Session'
): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      `${label} column "${column}" must be a non-negative safe integer.`
    );
  }
  return value;
}

export function normalizePersistedTurnId(value: string, label: string): TurnId {
  try {
    return parseTurnId(value);
  } catch (cause: unknown) {
    throw new AgentSessionError('SESSION_RECORD_INVALID', `${label} is invalid.`, { cause });
  }
}

export function normalizePersistedBranchId(
  value: string,
  label: string
): SessionBranchSnapshot['branchId'] {
  try {
    return parseSessionBranchId(value);
  } catch (cause: unknown) {
    throw new AgentSessionError('SESSION_RECORD_INVALID', `${label} is invalid.`, { cause });
  }
}

export function decodeTurn(row: SqliteRow): SessionTurn {
  const turnId = normalizePersistedTurnId(requireString(row, 'turn_id'), 'SQLite Session turn ID');
  const branchId = normalizePersistedBranchId(
    requireString(row, 'branch_id'),
    'SQLite Session turn branch ID'
  );
  const parentValue = optionalString(row, 'parent_turn_id');
  const parentTurnId =
    parentValue === undefined
      ? undefined
      : normalizePersistedTurnId(parentValue, 'SQLite Session parent turn ID');
  const lineage = {
    branchId,
    ...(parentTurnId === undefined ? {} : { parentTurnId }),
  } as const;
  const status = requireString(row, 'status');
  const userMessage = decodeUserMessage(requireString(row, 'user_message'));
  if (status === 'active') return Object.freeze({ status, turnId, ...lineage, userMessage });
  if (status === 'completed') {
    return Object.freeze({
      status,
      turnId,
      ...lineage,
      userMessage,
      assistantMessage: decodeAssistantMessage(requireString(row, 'assistant_message')),
    });
  }
  if (status === 'failed') {
    let failureCode: string;
    try {
      failureCode = parseSessionFailureCode(requireString(row, 'failure_code'));
    } catch (cause: unknown) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'SQLite Session record contains an invalid failure code.',
        { cause }
      );
    }
    return Object.freeze({ status, turnId, ...lineage, userMessage, failureCode });
  }
  throw new AgentSessionError(
    'SESSION_RECORD_INVALID',
    `SQLite Session record contains unsupported turn status "${status}".`
  );
}

export function decodeBranch(row: SqliteRow): SessionBranchSnapshot {
  const parentValue = optionalString(row, 'parent_branch_id');
  const forkValue = optionalString(row, 'forked_from_turn_id');
  const headValue = optionalString(row, 'head_turn_id');
  return Object.freeze({
    branchId: normalizePersistedBranchId(
      requireString(row, 'branch_id'),
      'SQLite Session branch ID'
    ),
    ...(parentValue === undefined
      ? {}
      : {
          parentBranchId: normalizePersistedBranchId(
            parentValue,
            'SQLite Session parent branch ID'
          ),
        }),
    ...(forkValue === undefined
      ? {}
      : {
          forkedFromTurnId: normalizePersistedTurnId(forkValue, 'SQLite Session fork turn ID'),
        }),
    ...(headValue === undefined
      ? {}
      : {
          headTurnId: normalizePersistedTurnId(headValue, 'SQLite Session branch head turn ID'),
        }),
    createdAt: requireNonNegativeInteger(row, 'created_at'),
  });
}

export function normalizeReference(reference: SessionReference): SessionReference {
  return Object.freeze({
    agentId: parseAgentId(reference.agentId),
    sessionId: parseSessionId(reference.sessionId),
  });
}

export function requireSession(database: DatabaseSync, reference: SessionReference): SqliteRow {
  const row = database
    .prepare(
      `SELECT selected_branch_id, navigation_revision, next_turn_sequence
       FROM ta_agent_base_sessions
       WHERE agent_id = ? AND session_id = ?`
    )
    .get(reference.agentId, reference.sessionId) as SqliteRow | undefined;
  if (row === undefined) {
    throw new AgentSessionError(
      'SESSION_NOT_FOUND',
      `Session "${reference.sessionId}" does not exist for agent "${reference.agentId}".`
    );
  }
  return row;
}

export function requireTurnRow(
  database: DatabaseSync,
  reference: SessionReference,
  turnId: TurnId
): SqliteRow {
  const row = database
    .prepare(
      `SELECT turn_id, status, user_message, assistant_message, failure_code, branch_id,
              parent_turn_id
       FROM ta_agent_base_session_turns
       WHERE agent_id = ? AND session_id = ? AND turn_id = ?`
    )
    .get(reference.agentId, reference.sessionId, turnId) as SqliteRow | undefined;
  if (row === undefined) {
    throw new AgentSessionError(
      'TURN_NOT_FOUND',
      `Turn "${turnId}" does not exist in session "${reference.sessionId}".`
    );
  }
  return row;
}
