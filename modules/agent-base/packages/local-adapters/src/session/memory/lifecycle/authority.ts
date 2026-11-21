import {
  AgentSessionError,
  assertSessionExecutionAllowed,
  assertSessionExecutionLease,
  normalizeSessionExecutionLease,
  normalizeSessionReference,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
  type SessionExecutionFence,
  type SessionExecutionLease,
  type SessionLifecycleMutationInput,
  type SessionLifecycleSnapshot,
  type SessionReference,
  type SessionWriteAuthority,
} from '@print-an-agent/base-session';
import { memorySessionKey } from '../state/lookup.js';
import type { StoredMemorySession } from '../types/state.js';
import { acquireMemoryExecution, releaseMemoryExecution } from './execution.js';
import { purgeMemorySession, recoverMemorySession } from './maintenance.js';
import { transitionMemorySession } from './retirement.js';
import { memoryExecutionFence, memoryLifecycleSnapshot } from './state.js';

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
    return acquireMemoryExecution(this, reference);
  }

  release(input: SessionExecutionLease): void {
    releaseMemoryExecution(this, input);
  }

  transition(
    input: SessionLifecycleMutationInput,
    operation: 'retire' | 'restore'
  ): SessionLifecycleSnapshot {
    return transitionMemorySession(this, this.clock, input, operation);
  }

  purge(input: PurgeSessionInput): void {
    purgeMemorySession(this, this.sessions, input);
  }

  recover(input: RecoverSessionExecutionsInput): SessionExecutionFence {
    return recoverMemorySession(this, this.clock, input);
  }
}
