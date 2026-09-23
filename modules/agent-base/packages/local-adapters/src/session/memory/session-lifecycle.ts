import { randomUUID } from 'node:crypto';
import {
  AgentSessionError,
  assertSessionExecutionAllowed,
  assertSessionExecutionLease,
  assertSessionPurgeAllowed,
  assertSessionRecoveryRevision,
  normalizeSessionReference,
  normalizeSessionExecutionLease,
  normalizeSessionLifecycleMutationInput,
  normalizePurgeSessionInput,
  normalizeRecoverSessionExecutionsInput,
  parseSessionExecutionId,
  retireSessionState,
  restoreSessionState,
  type SessionReference,
  type SessionWriteAuthority,
  type SessionExecutionLease,
  type SessionExecutionFence,
  type SessionLifecycleSnapshot,
  type SessionLifecycleMutationInput,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
} from '@ta-agent/base-session';
import { memorySessionKey, readMemoryClock, type StoredMemorySession } from './session-state.js';

export function memoryLifecycleSnapshot(session: StoredMemorySession): SessionLifecycleSnapshot {
  return Object.freeze({
    agentId: session.agentId,
    sessionId: session.sessionId,
    metadataRevision: session.metadataRevision,
    metadataUpdatedAt: session.metadataUpdatedAt,
    ...session.lifecycle,
  });
}

export function memoryExecutionFence(session: StoredMemorySession): SessionExecutionFence {
  return Object.freeze({
    revision: session.executionRevision,
    state: session.executionState,
    activeLeaseCount: session.executions.size,
    pendingWorkCount: session.turns.filter((turn) => turn.status === 'active').length,
  });
}

export function advanceMemoryExecution(session: StoredMemorySession): void {
  if (session.executionRevision >= Number.MAX_SAFE_INTEGER) {
    throw new AgentSessionError(
      'SESSION_EXECUTION_INVALID',
      'Session execution revision exhausted.'
    );
  }
  session.executionRevision += 1;
}

/** Synchronous critical sections; callers must not await between validation and mutation. */
export class MemorySessionLifecycle {
  constructor(
    private readonly sessions: Map<string, StoredMemorySession>,
    private readonly clock: () => number
  ) {}

  require(reference: SessionReference): StoredMemorySession {
    const normalized = normalizeSessionReference({
      agentId: reference.agentId,
      sessionId: reference.sessionId,
    });
    const session = this.sessions.get(memorySessionKey(normalized.agentId, normalized.sessionId));
    if (session === undefined)
      throw new AgentSessionError('SESSION_NOT_FOUND', 'Session does not exist.');
    return session;
  }

  assertOpen(reference: SessionReference): void {
    const session = this.require(reference);
    assertSessionExecutionAllowed(
      memoryLifecycleSnapshot(session),
      reference,
      memoryExecutionFence(session)
    );
  }

  assertWrite(request: SessionReference & SessionWriteAuthority): StoredMemorySession {
    const session = this.require(request);
    this.assertOpen(request);
    if (request.execution === undefined) {
      throw new AgentSessionError(
        'SESSION_EXECUTION_STALE',
        'Session write requires execution authority.'
      );
    }
    const lease = normalizeSessionExecutionLease(request.execution);
    const registered =
      lease.agentId === request.agentId && lease.sessionId === request.sessionId
        ? session.executions.get(lease.executionId)
        : undefined;
    assertSessionExecutionLease(
      memoryLifecycleSnapshot(session),
      lease,
      registered,
      memoryExecutionFence(session)
    );
    if (session.executionRevision >= Number.MAX_SAFE_INTEGER) {
      throw new AgentSessionError(
        'SESSION_EXECUTION_INVALID',
        'Session execution revision exhausted.'
      );
    }
    return session;
  }

  acquire(reference: SessionReference): SessionExecutionLease {
    this.assertOpen(reference);
    const session = this.require(reference);
    const lease = Object.freeze({
      agentId: session.agentId,
      sessionId: session.sessionId,
      executionId: parseSessionExecutionId(randomUUID()),
    });
    advanceMemoryExecution(session);
    session.executions.set(lease.executionId, lease);
    return lease;
  }

  release(input: SessionExecutionLease): void {
    const lease = normalizeSessionExecutionLease(input);
    const session = this.assertWrite({ ...lease, execution: lease });
    advanceMemoryExecution(session);
    session.executions.delete(lease.executionId);
  }

  transition(
    input: SessionLifecycleMutationInput,
    operation: 'retire' | 'restore'
  ): SessionLifecycleSnapshot {
    const request = normalizeSessionLifecycleMutationInput(input);
    const session = this.require(request);
    const decide = operation === 'retire' ? retireSessionState : restoreSessionState;
    const next = decide(
      memoryLifecycleSnapshot(session),
      request,
      memoryExecutionFence(session),
      Math.max(session.metadataUpdatedAt, readMemoryClock(this.clock))
    );
    session.lifecycle =
      next.status === 'active'
        ? { status: 'active' }
        : { status: 'retired', retiredAt: next.retiredAt };
    session.metadataRevision = next.metadataRevision;
    session.metadataUpdatedAt = next.metadataUpdatedAt;
    return next;
  }

  purge(input: PurgeSessionInput): void {
    const request = normalizePurgeSessionInput(input);
    const session = this.require(request);
    assertSessionPurgeAllowed(
      memoryLifecycleSnapshot(session),
      request,
      memoryExecutionFence(session)
    );
    this.sessions.delete(memorySessionKey(request.agentId, request.sessionId));
  }

  recover(input: RecoverSessionExecutionsInput): SessionExecutionFence {
    const request = normalizeRecoverSessionExecutionsInput(input);
    const session = this.require(request);
    assertSessionRecoveryRevision(
      memoryLifecycleSnapshot(session),
      request,
      memoryExecutionFence(session)
    );
    advanceMemoryExecution(session);
    session.executionState = 'recovering';
    session.executions.clear();
    try {
      const now = readMemoryClock(this.clock);
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
}
