import {
  AgentSessionError,
  assertSessionExecutionAllowed,
  assertSessionExecutionLease,
  assertSessionPurgeAllowed,
  assertSessionRecoveryRevision,
  defineSessionExecutionFence,
  defineSessionLifecycleSnapshot,
  normalizePurgeSessionInput,
  normalizeRecoverSessionExecutionsInput,
  normalizeSessionExecutionLease,
  normalizeSessionLifecycleMutationInput,
  parseSessionExecutionId,
  restoreSessionState,
  retireSessionState,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
  type SessionExecutionLease,
  type SessionLifecycleMutationInput,
  type SessionReference,
  type SessionWriteAuthority,
} from '@print-an-agent/base-session';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { readClock, runImmediateTransaction } from './database.js';
import { sessionMemoryTable } from './session-memory-storage.js';
import { requireString } from './session-record-codec.js';
import { quoteSqliteIdentifier as quote, type SqliteSessionTableNames } from './table-names.js';

export function readSqliteLifecycle(
  db: DatabaseSync,
  ref: SessionReference,
  names: SqliteSessionTableNames
) {
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

export function assertSqliteSessionOpen(
  db: DatabaseSync,
  ref: SessionReference,
  names: SqliteSessionTableNames
): void {
  const { snapshot, fence } = readSqliteLifecycle(db, ref, names);
  assertSessionExecutionAllowed(snapshot, ref, fence);
}

export function assertSqliteSessionWrite(
  db: DatabaseSync,
  request: SessionReference & SessionWriteAuthority,
  names: SqliteSessionTableNames
): void {
  const { snapshot, fence, ids } = readSqliteLifecycle(db, request, names);
  assertSessionExecutionAllowed(snapshot, request, fence);
  if (request.execution === undefined)
    throw new AgentSessionError(
      'SESSION_EXECUTION_STALE',
      'Session write requires execution authority.'
    );
  const lease = normalizeSessionExecutionLease(request.execution);
  const matches =
    lease.agentId === request.agentId &&
    lease.sessionId === request.sessionId &&
    ids.includes(lease.executionId);
  assertSessionExecutionLease(snapshot, lease, matches ? lease : undefined, fence);
}

export function acquireSqliteExecution(
  db: DatabaseSync,
  ref: SessionReference,
  names: SqliteSessionTableNames
): SessionExecutionLease {
  return runImmediateTransaction(db, () => {
    assertSqliteSessionOpen(db, ref, names);
    const { ids } = readSqliteLifecycle(db, ref, names);
    const executionId = parseSessionExecutionId(randomUUID());
    advanceSqliteExecution(db, ref, names);
    db.prepare(
      `UPDATE ${quote(names.sessions)} SET execution_leases = ? WHERE agent_id = ? AND session_id = ?`
    ).run(JSON.stringify([...ids, executionId]), ref.agentId, ref.sessionId);
    return Object.freeze({ agentId: ref.agentId, sessionId: ref.sessionId, executionId });
  });
}

export function releaseSqliteExecution(
  db: DatabaseSync,
  input: SessionExecutionLease,
  names: SqliteSessionTableNames
): void {
  const lease = normalizeSessionExecutionLease(input);
  runImmediateTransaction(db, () => {
    assertSqliteSessionWrite(db, { ...lease, execution: lease }, names);
    const { ids } = readSqliteLifecycle(db, lease, names);
    advanceSqliteExecution(db, lease, names);
    db.prepare(
      `UPDATE ${quote(names.sessions)} SET execution_leases = ? WHERE agent_id = ? AND session_id = ?`
    ).run(
      JSON.stringify(ids.filter((id) => id !== lease.executionId)),
      lease.agentId,
      lease.sessionId
    );
  });
}

export function transitionSqliteSession(
  db: DatabaseSync,
  input: SessionLifecycleMutationInput,
  operation: 'retire' | 'restore',
  clock: () => number,
  names: SqliteSessionTableNames
) {
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

export function purgeSqliteSession(
  db: DatabaseSync,
  input: PurgeSessionInput,
  names: SqliteSessionTableNames
): void {
  const request = normalizePurgeSessionInput(input);
  runImmediateTransaction(db, () => {
    const { snapshot, fence } = readSqliteLifecycle(db, request, names);
    assertSessionPurgeAllowed(snapshot, request, fence);
    try {
      db.prepare(`DELETE FROM ${quote(names.sessions)} WHERE agent_id = ? AND session_id = ?`).run(
        request.agentId,
        request.sessionId
      );
    } catch (cause: unknown) {
      throw new AgentSessionError('SESSION_PURGE_FAILED', 'Session deletion failed.', { cause });
    }
  });
}

/** One write lock spans revocation and reconciliation; failed work rolls back without reopening admission. */
export function recoverSqliteSession(
  db: DatabaseSync,
  input: RecoverSessionExecutionsInput,
  clock: () => number,
  names: SqliteSessionTableNames,
  reconcile?: () => void
) {
  const request = normalizeRecoverSessionExecutionsInput(input);
  const result = runImmediateTransaction(db, () => {
    const { snapshot, fence } = readSqliteLifecycle(db, request, names);
    assertSessionRecoveryRevision(snapshot, request, fence);
    advanceSqliteExecution(db, request, names);
    db.prepare(
      `UPDATE ${quote(names.sessions)} SET execution_state = 'recovering', execution_leases = '[]'
      WHERE agent_id = ? AND session_id = ?`
    ).run(request.agentId, request.sessionId);
    db.exec('SAVEPOINT session_recovery_work');
    try {
      const pendingMemory = db
        .prepare(
          `SELECT 1 FROM ${quote(sessionMemoryTable(names))} WHERE agent_id=? AND session_id=? AND settled=0 LIMIT 1`
        )
        .get(request.agentId, request.sessionId);
      if (pendingMemory !== undefined)
        throw new AgentSessionError(
          'SESSION_MEMORY_PENDING',
          'Memory coordination must be recovered before Session recovery can finish.'
        );
      const now = readClock(clock);
      db.prepare(
        `UPDATE ${quote(names.turns)} SET status = 'failed', failure_code = 'SESSION_EXECUTION_INTERRUPTED',
        finished_at = MAX(started_at, ?) WHERE agent_id = ? AND session_id = ? AND status = 'active'`
      ).run(now, request.agentId, request.sessionId);
      reconcile?.();
      advanceSqliteExecution(db, request, names);
      db.prepare(
        `UPDATE ${quote(names.sessions)} SET execution_state = 'ready', updated_at = MAX(updated_at, ?)
        WHERE agent_id = ? AND session_id = ?`
      ).run(now, request.agentId, request.sessionId);
      db.exec('RELEASE session_recovery_work');
      return readSqliteLifecycle(db, request, names).fence;
    } catch (cause: unknown) {
      db.exec('ROLLBACK TO session_recovery_work');
      db.exec('RELEASE session_recovery_work');
      return new AgentSessionError('SESSION_RECOVERY_FAILED', 'Session recovery remains fenced.', {
        cause,
      });
    }
  });
  if (result instanceof AgentSessionError) throw result;
  return result;
}
