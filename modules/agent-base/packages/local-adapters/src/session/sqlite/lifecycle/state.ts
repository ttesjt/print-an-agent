import {
  AgentSessionError,
  defineSessionExecutionFence,
  defineSessionLifecycleSnapshot,
  parseSessionExecutionId,
  type SessionReference,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { requireString } from '../codecs/columns.js';
import { quoteSqliteIdentifier as quote, sessionMemoryTable } from '../table-names.js';
import type { SqliteSessionLifecycleState } from '../types/lifecycle.js';
import type { SqliteSessionTableNames } from '../types/table-names.js';

export function readSqliteLifecycle(
  db: DatabaseSync,
  ref: SessionReference,
  names: SqliteSessionTableNames
): SqliteSessionLifecycleState {
  const row = db
    .prepare(
      `SELECT lifecycle_status, retired_at, metadata_revision, metadata_updated_at,
    execution_revision, execution_state, execution_leases,
    (SELECT count(*) FROM ${quote(names.turns)} t WHERE t.agent_id = s.agent_id
      AND t.session_id = s.session_id AND t.status = 'active') +
    (SELECT count(*) FROM ${quote(sessionMemoryTable(names))} m WHERE m.agent_id=s.agent_id AND m.session_id=s.session_id AND m.settled=0) AS pending
    FROM ${quote(names.sessions)} s WHERE agent_id = ? AND session_id = ?`
    )
    .get(ref.agentId, ref.sessionId);
  if (row === undefined)
    throw new AgentSessionError('SESSION_NOT_FOUND', 'Session does not exist.');
  const snapshot = defineSessionLifecycleSnapshot({
    agentId: ref.agentId,
    sessionId: ref.sessionId,
    status: row.lifecycle_status,
    metadataRevision: row.metadata_revision,
    metadataUpdatedAt: row.metadata_updated_at,
    ...(row.retired_at === null ? {} : { retiredAt: row.retired_at }),
  });
  const raw: unknown = JSON.parse(requireString(row, 'execution_leases'));
  if (!Array.isArray(raw))
    throw new AgentSessionError('SESSION_EXECUTION_INVALID', 'Invalid execution ledger.');
  const ids = raw.map((id: unknown) => parseSessionExecutionId(id));
  if (new Set(ids).size !== ids.length)
    throw new AgentSessionError('SESSION_EXECUTION_INVALID', 'Duplicate execution credential.');
  const fence = defineSessionExecutionFence({
    revision: row.execution_revision,
    state: row.execution_state,
    activeLeaseCount: ids.length,
    pendingWorkCount: row.pending,
  });
  return { snapshot, fence, ids };
}

export function advanceSqliteExecution(
  db: DatabaseSync,
  ref: SessionReference,
  names: SqliteSessionTableNames
): void {
  const { fence } = readSqliteLifecycle(db, ref, names);
  if (fence.revision >= Number.MAX_SAFE_INTEGER)
    throw new AgentSessionError('SESSION_EXECUTION_INVALID', 'Execution revision exhausted.');
  db.prepare(
    `UPDATE ${quote(names.sessions)} SET execution_revision = execution_revision + 1
    WHERE agent_id = ? AND session_id = ?`
  ).run(ref.agentId, ref.sessionId);
}
