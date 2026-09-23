import { AgentSessionError } from '../errors.js';
import type {
  PurgeSessionInput,
  SessionLifecycleMutationInput,
  SessionLifecycleSnapshot,
} from './contracts.js';
import type { SessionExecutionFence } from './execution.js';
import { assertSessionIdle, requireSessionMetadataRevision } from './guards.js';
import { lifecycleInteger } from './validation-record.js';
import {
  normalizePurgeSessionInput,
  normalizeSessionLifecycleMutationInput,
} from './validation.js';

/** Pure decision only. An adapter must commit this together with identity/CAS/occupancy checks. */
export function retireSessionState(
  current: SessionLifecycleSnapshot | undefined,
  input: SessionLifecycleMutationInput,
  fence: SessionExecutionFence,
  timestamp: number
): SessionLifecycleSnapshot {
  const snapshot = requireSessionMetadataRevision(
    current,
    normalizeSessionLifecycleMutationInput(input)
  );
  if (snapshot.status === 'retired') {
    throw new AgentSessionError('SESSION_ALREADY_RETIRED', 'Session is already retired.');
  }
  assertSessionIdle(fence);
  return Object.freeze({
    ...transitionMetadata(snapshot, timestamp),
    status: 'retired',
    retiredAt: timestamp,
  });
}

export function restoreSessionState(
  current: SessionLifecycleSnapshot | undefined,
  input: SessionLifecycleMutationInput,
  fence: SessionExecutionFence,
  timestamp: number
): SessionLifecycleSnapshot {
  const snapshot = requireSessionMetadataRevision(
    current,
    normalizeSessionLifecycleMutationInput(input)
  );
  if (snapshot.status !== 'retired') {
    throw new AgentSessionError('SESSION_NOT_RETIRED', 'Session is not retired.');
  }
  assertSessionIdle(fence);
  return Object.freeze({ ...transitionMetadata(snapshot, timestamp), status: 'active' });
}

export function assertSessionPurgeAllowed(
  current: SessionLifecycleSnapshot | undefined,
  input: PurgeSessionInput,
  fence: SessionExecutionFence
): void {
  const snapshot = requireSessionMetadataRevision(current, normalizePurgeSessionInput(input));
  if (snapshot.status !== 'retired') {
    throw new AgentSessionError('SESSION_NOT_RETIRED', 'Only retired Sessions may be purged.');
  }
  assertSessionIdle(fence);
}

function transitionMetadata(snapshot: SessionLifecycleSnapshot, timestamp: number) {
  lifecycleInteger(timestamp);
  const revision = lifecycleInteger(snapshot.metadataRevision + 1);
  if (timestamp < snapshot.metadataUpdatedAt) {
    throw new AgentSessionError(
      'SESSION_LIFECYCLE_INVALID',
      'Lifecycle timestamp cannot move backwards.'
    );
  }
  return {
    agentId: snapshot.agentId,
    sessionId: snapshot.sessionId,

    metadataRevision: revision,
    metadataUpdatedAt: timestamp,
  };
}
