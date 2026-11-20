import type { SessionReference } from '../../contracts/index.js';
import { AgentSessionError } from '../../errors.js';
import type { SessionLifecycleMutationInput, SessionLifecycleSnapshot } from './types.js';

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

export function sameReference(left: SessionReference, right: SessionReference): boolean {
  return left.agentId === right.agentId && left.sessionId === right.sessionId;
}
