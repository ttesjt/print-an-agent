import type { DatabaseSync } from 'node:sqlite';
import { REQUEST_EXECUTION_INTERRUPTED } from '@print-an-agent/base-request';
import { normalizeSessionReference, type SessionReference } from '@print-an-agent/base-session';
import {
  quoteSqliteIdentifier as quote,
  type SqliteRequestJournalTableNames,
} from './table-names.js';
import { readJournalClock } from './database.js';

export function purgeSqliteSessionRequests(
  db: DatabaseSync,
  reference: SessionReference,
  names: SqliteRequestJournalTableNames
): void {
  const ref = normalizeSessionReference(reference);
  db.prepare(`DELETE FROM ${quote(names.entries)} WHERE agent_id = ? AND session_id = ?`).run(
    ref.agentId,
    ref.sessionId
  );
}

export function recoverSqliteSessionRequests(
  db: DatabaseSync,
  reference: SessionReference,
  clock: () => number,
  names: SqliteRequestJournalTableNames
): void {
  const ref = normalizeSessionReference(reference);
  db.prepare(
    `UPDATE ${quote(names.entries)} SET status = 'failed', failure_code = ?,
    failure_message = 'Request execution was interrupted.', finished_at = MAX(started_at, ?)
    WHERE agent_id = ? AND session_id = ? AND status = 'active'`
  ).run(REQUEST_EXECUTION_INTERRUPTED, readJournalClock(clock), ref.agentId, ref.sessionId);
}
