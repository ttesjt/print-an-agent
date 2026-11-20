import type { SessionLifecycleMutationInput, SessionLifecycleSnapshot } from '../state/index.js';

export type RetireSessionInput = SessionLifecycleMutationInput;

export type RestoreSessionInput = SessionLifecycleMutationInput;

/** Adapters check identity, CAS, state and occupancy together with the commit. */
export interface SessionLifecyclePort {
  retireSession(input: RetireSessionInput): Promise<SessionLifecycleSnapshot>;
  restoreSession(input: RestoreSessionInput): Promise<SessionLifecycleSnapshot>;
}

export interface PurgeSessionInput extends SessionLifecycleMutationInput {
  readonly confirmation: 'permanently-delete-session';
}

/**
 * Optional atomic deletion of a retired, idle Session aggregate only.
 * Includes branches, turns, presentation, navigation, compaction and Session-owned execution state.
 * Excludes records owned by other domains. Cross-domain cleanup requires a separate composed
 * capability; this port does not attest it. No partially visible success within the Session scope.
 * The exact reference is absent after success, not a new `purged` record.
 */
export interface SessionPurgePort {
  purgeSession(input: PurgeSessionInput): Promise<void>;
}
