import {
  AgentSessionError,
  type SessionBranchReference,
  type SessionReference,
  type TurnId,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { quoteSqliteIdentifier } from './table-names.js';
import type { SqliteRow } from './types/record.js';
import type { SqliteSessionTableNames } from './types/table-names.js';

export function requireSession(
  database: DatabaseSync,
  reference: SessionReference,
  tableNames: SqliteSessionTableNames
): SqliteRow {
  const row = database
    .prepare(
      `SELECT selected_branch_id, navigation_revision, next_turn_sequence, created_at, updated_at
       FROM ${quoteSqliteIdentifier(tableNames.sessions)}
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
  turnId: TurnId,
  tableNames: SqliteSessionTableNames
): SqliteRow {
  const row = database
    .prepare(
      `SELECT turn_id, status, user_message, assistant_message, failure_code, branch_id,
              parent_turn_id
       FROM ${quoteSqliteIdentifier(tableNames.turns)}
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

export function readCompactionRow(
  database: DatabaseSync,
  reference: SessionBranchReference,
  tableNames: SqliteSessionTableNames
): SqliteRow | undefined {
  return database
    .prepare(
      `SELECT revision, through_turn_id, context_message, created_at
       FROM ${quoteSqliteIdentifier(tableNames.compactions)}
       WHERE agent_id = ? AND session_id = ? AND branch_id = ?`
    )
    .get(reference.agentId, reference.sessionId, reference.branchId) as SqliteRow | undefined;
}
