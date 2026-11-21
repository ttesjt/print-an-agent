import {
  AgentRequestError,
  type RequestJournalEntry,
  type RequestJournalReference,
} from '@print-an-agent/base-request';
import type { DatabaseSync } from 'node:sqlite';
import { decodeEntry } from './entry-codec.js';
import { quoteSqliteIdentifier } from './table-names.js';
import type { SqliteRow } from './types/record.js';
import type { SqliteRequestJournalTableNames } from './types/table-names.js';

export function selectEntry(
  database: DatabaseSync,
  reference: RequestJournalReference,
  tableNames: SqliteRequestJournalTableNames
): SqliteRow | undefined {
  return database
    .prepare(
      `SELECT agent_id, session_id, idempotency_key, fingerprint, request_id, status,
              response_json, failure_code, failure_message, started_at, finished_at
       FROM ${quoteSqliteIdentifier(tableNames.entries)}
       WHERE agent_id = ? AND session_id = ? AND idempotency_key = ?`
    )
    .get(reference.agentId, reference.sessionId, reference.idempotencyKey) as SqliteRow | undefined;
}

export function requireEntry(
  database: DatabaseSync,
  reference: RequestJournalReference,
  tableNames: SqliteRequestJournalTableNames
): RequestJournalEntry {
  const row = selectEntry(database, reference, tableNames);
  if (row === undefined) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_NOT_FOUND',
      `Request Journal entry "${reference.idempotencyKey}" does not exist.`
    );
  }
  return decodeEntry(row);
}
