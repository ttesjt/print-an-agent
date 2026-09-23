import type { DatabaseSync } from 'node:sqlite';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  type ResolvedSessionReference,
  type SessionReference,
} from '@ta-agent/base-session';
import { readClock, runImmediateTransaction } from './database.js';
import { loadSqliteSessionSnapshot } from './session-navigation-storage.js';
import { quoteSqliteIdentifier, type SqliteSessionTableNames } from './table-names.js';

export function openSqliteSession(
  database: DatabaseSync,
  reference: SessionReference,
  tableNames: SqliteSessionTableNames
): ResolvedSessionReference {
  const snapshot = loadSqliteSessionSnapshot(database, reference, tableNames);
  return Object.freeze({
    ...reference,
    branchId: snapshot.navigation.selectedBranchId,
    navigationRevision: snapshot.navigation.revision,
  });
}

export function createSqliteSession(
  database: DatabaseSync,
  reference: SessionReference,
  clock: () => number,
  tableNames: SqliteSessionTableNames
): ResolvedSessionReference {
  return runImmediateTransaction(database, () => {
    const existing = database
      .prepare(`SELECT 1 FROM ${quoteSqliteIdentifier(tableNames.sessions)} WHERE session_id = ?`)
      .get(reference.sessionId);
    if (existing !== undefined) {
      throw new AgentSessionError(
        'SESSION_ID_CONFLICT',
        'Session ID generator returned an existing identity.'
      );
    }
    const createdAt = readClock(clock);
    database
      .prepare(
        `INSERT INTO ${quoteSqliteIdentifier(tableNames.sessions)}
        (agent_id, session_id, next_turn_sequence, created_at, selected_branch_id,
         navigation_revision, updated_at)
       VALUES (?, ?, 0, ?, ?, 0, ?)`
      )
      .run(reference.agentId, reference.sessionId, createdAt, DEFAULT_SESSION_BRANCH_ID, createdAt);
    database
      .prepare(
        `INSERT INTO ${quoteSqliteIdentifier(tableNames.branches)}
        (agent_id, session_id, branch_id, created_at) VALUES (?, ?, ?, ?)`
      )
      .run(reference.agentId, reference.sessionId, DEFAULT_SESSION_BRANCH_ID, createdAt);
    return openSqliteSession(database, reference, tableNames);
  });
}
