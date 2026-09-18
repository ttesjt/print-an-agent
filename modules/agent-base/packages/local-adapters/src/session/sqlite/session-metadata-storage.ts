import type { DatabaseSync } from 'node:sqlite';

import {
  AgentSessionError,
  normalizeRenameSessionInput,
  type RenameSessionInput,
  type SessionInspection,
} from '@ta-agent/base-session';

import { readClock, runImmediateTransaction } from './database.js';
import { inspectSqliteSession } from './session-query-storage.js';
import { requireNonNegativeInteger, type SqliteRow } from './session-record-codec.js';
import { quoteSqliteIdentifier, type SqliteSessionTableNames } from './table-names.js';

export function renameSqliteSession(
  database: DatabaseSync,
  input: RenameSessionInput,
  clock: () => number,
  tableNames: SqliteSessionTableNames
): SessionInspection {
  const request = normalizeRenameSessionInput(input);
  return runImmediateTransaction(database, () => {
    const row = database
      .prepare(
        `SELECT metadata_revision FROM ${quoteSqliteIdentifier(tableNames.sessions)}
         WHERE agent_id = ? AND session_id = ?`
      )
      .get(request.agentId, request.sessionId) as SqliteRow | undefined;
    if (row === undefined) {
      throw new AgentSessionError(
        'SESSION_NOT_FOUND',
        `Session "${request.sessionId}" does not exist for agent "${request.agentId}".`
      );
    }
    const revision = requireNonNegativeInteger(row, 'metadata_revision');
    if (revision !== request.expectedRevision) {
      throw new AgentSessionError(
        'SESSION_METADATA_CONFLICT',
        `Session metadata expected revision ${request.expectedRevision} but found ${revision}.`
      );
    }
    const timestamp = readClock(clock);
    database
      .prepare(
        `UPDATE ${quoteSqliteIdentifier(tableNames.sessions)}
         SET title = ?, metadata_revision = ?, metadata_updated_at = MAX(metadata_updated_at, ?)
         WHERE agent_id = ? AND session_id = ?`
      )
      .run(request.title, revision + 1, timestamp, request.agentId, request.sessionId);
    const renamed = inspectSqliteSession(database, request, tableNames);
    if (renamed === undefined) {
      throw new AgentSessionError('SESSION_NOT_FOUND', 'Session disappeared during rename.');
    }
    return renamed;
  });
}
