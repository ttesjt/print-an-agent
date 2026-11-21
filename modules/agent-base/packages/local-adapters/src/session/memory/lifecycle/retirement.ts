import {
  normalizeSessionLifecycleMutationInput,
  restoreSessionState,
  retireSessionState,
  type SessionLifecycleMutationInput,
  type SessionLifecycleSnapshot,
} from '@print-an-agent/base-session';
import { readMemoryClock } from '../state/clock.js';
import type { MemorySessionAuthority } from '../types/lifecycle.js';
import { memoryExecutionFence, memoryLifecycleSnapshot } from './state.js';

export function transitionMemorySession(
  authority: MemorySessionAuthority,
  clock: () => number,
  input: SessionLifecycleMutationInput,
  operation: 'retire' | 'restore'
): SessionLifecycleSnapshot {
  const request = normalizeSessionLifecycleMutationInput(input);
  const session = authority.require(request);
  const decide = operation === 'retire' ? retireSessionState : restoreSessionState;
  const next = decide(
    memoryLifecycleSnapshot(session),
    request,
    memoryExecutionFence(session),
    Math.max(session.metadataUpdatedAt, readMemoryClock(clock))
  );
  session.lifecycle =
    next.status === 'active'
      ? { status: 'active' }
      : { status: 'retired', retiredAt: next.retiredAt };
  session.metadataRevision = next.metadataRevision;
  session.metadataUpdatedAt = next.metadataUpdatedAt;
  return next;
}
