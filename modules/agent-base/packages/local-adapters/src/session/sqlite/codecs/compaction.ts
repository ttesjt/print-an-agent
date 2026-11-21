import {
  AgentSessionError,
  type SessionBranchReference,
  type SessionCompaction,
} from '@print-an-agent/base-session';
import type { SqliteRow } from '../types/record.js';
import { requireNonNegativeInteger, requireString } from './columns.js';
import { normalizePersistedTurnId } from './identifiers.js';
import { decodeContextMessage } from './message.js';

export function requirePositiveInteger(row: SqliteRow, column: string): number {
  const value = requireNonNegativeInteger(row, column, 'SQLite Session compaction');
  if (value === 0) {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      `SQLite Session compaction column "${column}" must be positive.`
    );
  }
  return value;
}

export function decodeCompaction(
  reference: SessionBranchReference,
  row: SqliteRow
): SessionCompaction {
  return Object.freeze({
    ...reference,
    revision: requirePositiveInteger(row, 'revision'),
    throughTurnId: normalizePersistedTurnId(
      requireString(row, 'through_turn_id'),
      'SQLite Session compaction turn ID'
    ),
    context: decodeContextMessage(requireString(row, 'context_message')),
  });
}
