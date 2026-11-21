import {
  AgentSessionError,
  assertSessionPurgeAllowed,
  assertSessionRecoveryRevision,
  normalizePurgeSessionInput,
  normalizeRecoverSessionExecutionsInput,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
  type SessionExecutionFence,
} from '@print-an-agent/base-session';
import { readMemoryClock } from '../state/clock.js';
import { memorySessionKey } from '../state/lookup.js';
import type { MemorySessionAuthority } from '../types/lifecycle.js';
import type { StoredMemorySession } from '../types/state.js';
import { advanceMemoryExecution, memoryExecutionFence, memoryLifecycleSnapshot } from './state.js';

export function purgeMemorySession(
  authority: MemorySessionAuthority,
  sessions: Map<string, StoredMemorySession>,
  input: PurgeSessionInput
): void {
  const request = normalizePurgeSessionInput(input);
  const session = authority.require(request);
  assertSessionPurgeAllowed(
    memoryLifecycleSnapshot(session),
    request,
    memoryExecutionFence(session)
  );
  sessions.delete(memorySessionKey(request.agentId, request.sessionId));
}

export function recoverMemorySession(
  authority: MemorySessionAuthority,
  clock: () => number,
  input: RecoverSessionExecutionsInput
): SessionExecutionFence {
  const request = normalizeRecoverSessionExecutionsInput(input);
  const session = authority.require(request);
  assertSessionRecoveryRevision(
    memoryLifecycleSnapshot(session),
    request,
    memoryExecutionFence(session)
  );
  advanceMemoryExecution(session);
  session.executionState = 'recovering';
  session.executions.clear();
  try {
    if ([...session.memoryRecords.values()].some((record) => !record.settled))
      throw new AgentSessionError(
        'SESSION_MEMORY_PENDING',
        'Memory coordination must be recovered before Session recovery can finish.'
      );
    const now = readMemoryClock(clock);
    const turns = session.turns.map((turn) =>
      turn.status !== 'active'
        ? turn
        : Object.freeze({
            ...turn,
            status: 'failed' as const,
            failureCode: 'SESSION_EXECUTION_INTERRUPTED',
          })
    );
    advanceMemoryExecution(session);
    session.turns.splice(0, session.turns.length, ...turns);
    session.updatedAt = Math.max(session.updatedAt, now);
    session.executionState = 'ready';
    return memoryExecutionFence(session);
  } catch (cause: unknown) {
    throw new AgentSessionError('SESSION_RECOVERY_FAILED', 'Session recovery remains fenced.', {
      cause,
    });
  }
}
