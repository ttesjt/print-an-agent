import type {
  SessionMemoryRecord,
  SessionMemoryRecordKey,
  WriteSessionMemoryRecord,
} from '@print-an-agent/base-session';
import { AgentSessionError, type SessionReference } from '@print-an-agent/base-session';
import { runImmediateTransaction } from '../database.js';
import { assertSqliteSessionWrite } from '../lifecycle/execution.js';
import { advanceSqliteExecution, readSqliteLifecycle } from '../lifecycle/state.js';
import { loadSqliteSessionSnapshot } from '../snapshot.js';
import type { SqliteSessionMemoryContext } from '../types/memory-coordination.js';
import {
  pendingSessionMemoryRecords,
  readSessionMemoryRecord,
  writeSessionMemoryRecord,
} from './records.js';

export function readSqliteMemoryRecord(
  context: SqliteSessionMemoryContext,
  key: SessionMemoryRecordKey
): Promise<SessionMemoryRecord | undefined> {
  return Promise.resolve().then(() =>
    context.useDatabase('read Memory coordination', (db) => {
      readSqliteLifecycle(db, key, context.tableNames);
      return readSessionMemoryRecord(db, key, context.tableNames);
    })
  );
}

export function listPendingSqliteMemoryRecords(
  context: SqliteSessionMemoryContext,
  ref: SessionReference
): Promise<readonly SessionMemoryRecord[]> {
  return Promise.resolve().then(() =>
    context.useDatabase('read pending Memory coordination', (db) => {
      readSqliteLifecycle(db, ref, context.tableNames);
      return pendingSessionMemoryRecords(db, ref, context.tableNames);
    })
  );
}

export function writeSqliteMemoryRecord(
  context: SqliteSessionMemoryContext,
  input: WriteSessionMemoryRecord
): Promise<SessionMemoryRecord> {
  return Promise.resolve().then(() =>
    context.useDatabase('write Memory coordination', (db) =>
      runImmediateTransaction(db, () => {
        if (input.execution !== undefined) assertSqliteSessionWrite(db, input, context.tableNames);
        else {
          const { snapshot, fence } = readSqliteLifecycle(db, input, context.tableNames);
          if (
            snapshot.status !== 'active' ||
            fence.activeLeaseCount !== 0 ||
            (fence.state === 'recovering' && input.expectedRevision === null)
          )
            throw new AgentSessionError(
              'SESSION_BUSY',
              'Memory coordination requires an idle Session or its execution lease.'
            );
        }
        if (input.kind === 'navigation' && input.expectedRevision === null) {
          const snapshot = loadSqliteSessionSnapshot(db, input, context.tableNames);
          if (
            snapshot?.turns.some((turn) => turn.status === 'active') ||
            pendingSessionMemoryRecords(db, input, context.tableNames).length !== 0
          )
            throw new AgentSessionError(
              'SESSION_BUSY',
              'Memory navigation requires an idle Session.'
            );
        }
        const result = writeSessionMemoryRecord(db, input, context.tableNames);
        advanceSqliteExecution(db, input, context.tableNames);
        return result;
      })
    )
  );
}
