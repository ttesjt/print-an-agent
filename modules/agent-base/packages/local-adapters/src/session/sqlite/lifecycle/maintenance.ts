import type { SessionExecutionFence } from '@print-an-agent/base-session';
import {
  AgentSessionError,
  assertSessionPurgeAllowed,
  assertSessionRecoveryRevision,
  normalizePurgeSessionInput,
  normalizeRecoverSessionExecutionsInput,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { readClock, runImmediateTransaction } from '../database.js';
import { quoteSqliteIdentifier as quote, sessionMemoryTable } from '../table-names.js';
import type { SqliteSessionTableNames } from '../types/table-names.js';
import { advanceSqliteExecution, readSqliteLifecycle } from './state.js';

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
): SessionExecutionFence {
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
