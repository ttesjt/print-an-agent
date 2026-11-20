import { AgentSessionError } from '../errors.js';
import { authorityInteger } from '../validation/authority-record.js';
import type { SessionExecutionFence } from './execution/index.js';
import { assertSessionIdle } from './execution/index.js';
import {
  normalizePurgeSessionInput,
  normalizeSessionLifecycleMutationInput,
} from './mutation-input.js';
import type { SessionLifecycleMutationInput, SessionLifecycleSnapshot } from './state/index.js';
import { requireSessionMetadataRevision } from './state/index.js';
import type { PurgeSessionInput } from './types/management.js';

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
  authorityInteger(timestamp);
  const revision = authorityInteger(snapshot.metadataRevision + 1);
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
