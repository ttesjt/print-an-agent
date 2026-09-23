import type { SessionReference } from '../types.js';
import { AgentSessionError } from '../errors.js';
import type { SessionLifecycleMutationInput, SessionLifecycleSnapshot } from './contracts.js';
import type {
  RecoverSessionExecutionsInput,
  SessionExecutionFence,
  SessionExecutionLease,
} from './execution.js';

/** All guards use authoritative adapter state and must run atomically with the protected write. */
export function requireSessionReference(
  current: SessionLifecycleSnapshot | undefined,
  reference: SessionReference
): SessionLifecycleSnapshot {
  if (current === undefined || !sameReference(current, reference)) {
    throw new AgentSessionError('SESSION_NOT_FOUND', 'Session does not exist.');
  }
  return current;
}

export function requireSessionMetadataRevision(
  current: SessionLifecycleSnapshot | undefined,
  input: SessionLifecycleMutationInput
): SessionLifecycleSnapshot {
  const snapshot = requireSessionReference(current, input);
  if (snapshot.metadataRevision !== input.expectedRevision) {
    throw new AgentSessionError('SESSION_METADATA_CONFLICT', 'Session metadata revision changed.');
  }
  return snapshot;
}

export function assertSessionIdle(fence: SessionExecutionFence): void {
  if (
    fence.state === 'recovering' ||
    fence.activeLeaseCount !== 0 ||
    fence.pendingWorkCount !== 0
  ) {
    throw new AgentSessionError('SESSION_BUSY', 'Session execution or recovery is unsettled.');
  }
}

/** Admission does not require exclusivity or a metadata revision. */
export function assertSessionExecutionAllowed(
  current: SessionLifecycleSnapshot | undefined,
  reference: SessionReference,
  fence: SessionExecutionFence
): void {
  const snapshot = requireSessionReference(current, reference);
  if (snapshot.status === 'retired') {
    throw new AgentSessionError('SESSION_RETIRED', 'Retired Session cannot execute.');
  }
  if (fence.state === 'recovering') {
    throw new AgentSessionError('SESSION_BUSY', 'Session recovery has not completed.');
  }
}

/** `registered` is an adapter lookup of a currently active lease, never caller-supplied evidence. */
export function assertSessionExecutionLease(
  current: SessionLifecycleSnapshot | undefined,
  supplied: SessionExecutionLease,
  registered: SessionExecutionLease | undefined,
  fence: SessionExecutionFence
): void {
  assertSessionExecutionAllowed(current, supplied, fence);
  if (
    registered === undefined ||
    !sameReference(registered, supplied) ||
    registered.executionId !== supplied.executionId
  ) {
    throw new AgentSessionError(
      'SESSION_EXECUTION_STALE',
      'Session execution credential is inactive.'
    );
  }
}

/** Recovery admission CAS; the adapter must also serialize recovery ownership. */
export function assertSessionRecoveryRevision(
  current: SessionLifecycleSnapshot | undefined,
  input: RecoverSessionExecutionsInput,
  fence: SessionExecutionFence
): void {
  requireSessionReference(current, input);
  if (fence.revision !== input.expectedExecutionRevision) {
    throw new AgentSessionError(
      'SESSION_EXECUTION_CONFLICT',
      'Session execution occupancy changed.'
    );
  }
}

function sameReference(left: SessionReference, right: SessionReference): boolean {
  return left.agentId === right.agentId && left.sessionId === right.sessionId;
}
