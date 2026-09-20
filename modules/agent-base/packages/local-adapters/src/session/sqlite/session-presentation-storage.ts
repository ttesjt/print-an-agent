import type { DatabaseSync } from 'node:sqlite';
import {
  AgentSessionError,
  defineSessionTurnPresentation,
  parseSessionBranchId,
  MAX_SESSION_PRESENTATION_CHARACTERS,
  MAX_SESSION_PRESENTATION_BLOCKS,
  type SessionTurnPresentationReference,
  type SessionTurnPresentationRecord,
} from '@ta-agent/base-session';
import { quoteSqliteIdentifier, type SqliteSessionTableNames } from './table-names.js';

export function readSqliteTurnPresentation(
  database: DatabaseSync,
  reference: SessionTurnPresentationReference,
  tableNames: SqliteSessionTableNames
): SessionTurnPresentationRecord | undefined {
  const row = database
    .prepare(
      `SELECT status, branch_id, presentation FROM ${quoteSqliteIdentifier(tableNames.turns)}
     WHERE agent_id = ? AND session_id = ? AND turn_id = ?`
    )
    .get(reference.agentId, reference.sessionId, reference.turnId);
  if (row === undefined || row.presentation === null) return undefined;
  try {
    // JSON escaping can expand one UTF-16 code unit to six characters.
    if (
      row.status !== 'completed' ||
      typeof row.presentation !== 'string' ||
      row.presentation.length >
        MAX_SESSION_PRESENTATION_CHARACTERS * 6 + MAX_SESSION_PRESENTATION_BLOCKS * 64 + 32
    ) {
      throw new Error('Invalid stored presentation envelope.');
    }
    const value: unknown = JSON.parse(row.presentation);
    return Object.freeze({
      ...reference,
      branchId: parseSessionBranchId(row.branch_id),
      presentation: defineSessionTurnPresentation(value),
    });
  } catch (cause: unknown) {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      'Stored Session presentation is invalid.',
      { cause }
    );
  }
}
