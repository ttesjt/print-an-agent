import type { SessionReference } from '../../contracts/index.js';
import { AgentSessionError } from '../../errors.js';
import type { SessionLifecycleSnapshot } from '../state/index.js';
import { requireSessionReference, sameReference } from '../state/index.js';
import type { SessionExecutionFence } from './types/fence.js';
import type { SessionExecutionLease } from './types/lease.js';

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
