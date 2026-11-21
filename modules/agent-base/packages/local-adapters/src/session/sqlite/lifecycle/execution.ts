import {
  AgentSessionError,
  assertSessionExecutionAllowed,
  assertSessionExecutionLease,
  normalizeSessionExecutionLease,
  parseSessionExecutionId,
  type SessionExecutionLease,
  type SessionReference,
  type SessionWriteAuthority,
} from '@print-an-agent/base-session';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { runImmediateTransaction } from '../database.js';
import { quoteSqliteIdentifier as quote } from '../table-names.js';
import type { SqliteSessionTableNames } from '../types/table-names.js';
import { advanceSqliteExecution, readSqliteLifecycle } from './state.js';

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
