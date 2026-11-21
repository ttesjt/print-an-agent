import type { SessionMemoryRecord } from '@print-an-agent/base-session';
import {
  AgentSessionError,
  decideMemoryRecord,
  memoryRecordKey,
  type SessionMemoryRecordKey,
  type SessionReference,
  type WriteSessionMemoryRecord,
} from '@print-an-agent/base-session';
import { advanceMemoryExecution } from '../lifecycle/state.js';
import type { MemorySessionAuthority } from '../types/lifecycle.js';
import type { MemorySessionState } from '../types/state.js';

export function readMemoryCoordinationRecord(
  state: MemorySessionState,
  authority: MemorySessionAuthority,
  input: SessionMemoryRecordKey
): Promise<SessionMemoryRecord | undefined> {
  return Promise.resolve().then(() => {
    const key = memoryRecordKey(input);
    return authority.require(key).memoryRecords.get(JSON.stringify([key.kind, key.id]));
  });
}

export function listPendingMemoryCoordinationRecords(
  state: MemorySessionState,
  authority: MemorySessionAuthority,
  ref: SessionReference
): Promise<SessionMemoryRecord[]> {
  return Promise.resolve().then(() =>
    [...authority.require(ref).memoryRecords.values()].filter((r) => !r.settled).slice(0, 100)
  );
}

export function writeMemoryCoordinationRecord(
  state: MemorySessionState,
  authority: MemorySessionAuthority,
  input: WriteSessionMemoryRecord
): Promise<SessionMemoryRecord> {
  return Promise.resolve().then(() => {
    const key = memoryRecordKey(input);
    const session =
      input.execution === undefined ? authority.require(key) : authority.assertWrite(input);
    if (
      input.execution === undefined &&
      (session.lifecycle.status !== 'active' ||
        session.executions.size !== 0 ||
        (session.executionState === 'recovering' && input.expectedRevision === null))
    )
      throw new AgentSessionError(
        'SESSION_BUSY',
        'Memory coordination requires an idle Session or its execution lease.'
      );
    const id = JSON.stringify([key.kind, key.id]);
    if (
      key.kind === 'navigation' &&
      input.expectedRevision === null &&
      (session.turns.some((turn) => turn.status === 'active') ||
        [...session.memoryRecords.values()].some((record) => !record.settled))
    )
      throw new AgentSessionError('SESSION_BUSY', 'Memory navigation requires an idle Session.');
    const next = decideMemoryRecord(session.memoryRecords.get(id), input);
    advanceMemoryExecution(session);
    session.memoryRecords.set(id, next);
    return next;
  });
}
