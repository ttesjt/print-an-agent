import type { SessionLifecycleSnapshot } from '@print-an-agent/base-session';
import {
  normalizeSessionLifecycleMutationInput,
  restoreSessionState,
  retireSessionState,
  type SessionLifecycleMutationInput,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { readClock, runImmediateTransaction } from '../database.js';
import { quoteSqliteIdentifier as quote } from '../table-names.js';
import type { SqliteSessionTableNames } from '../types/table-names.js';
import { readSqliteLifecycle } from './state.js';

export function transitionSqliteSession(
  db: DatabaseSync,
  input: SessionLifecycleMutationInput,
  operation: 'retire' | 'restore',
  clock: () => number,
  names: SqliteSessionTableNames
): SessionLifecycleSnapshot {
  const request = normalizeSessionLifecycleMutationInput(input);
  return runImmediateTransaction(db, () => {
    const { snapshot, fence } = readSqliteLifecycle(db, request, names);
    const decide = operation === 'retire' ? retireSessionState : restoreSessionState;
    const next = decide(
      snapshot,
      request,
      fence,
      Math.max(snapshot.metadataUpdatedAt, readClock(clock))
    );
    db.prepare(
      `UPDATE ${quote(names.sessions)} SET lifecycle_status = ?, retired_at = ?,
      metadata_revision = ?, metadata_updated_at = ? WHERE agent_id = ? AND session_id = ?`
    ).run(
      next.status,
      next.status === 'retired' ? next.retiredAt : null,
      next.metadataRevision,
      next.metadataUpdatedAt,
      request.agentId,
      request.sessionId
    );
    return next;
  });
}
