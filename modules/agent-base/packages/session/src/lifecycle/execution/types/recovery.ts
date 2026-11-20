import type { SessionReference } from '../../../contracts/index.js';
import type { SessionExecutionFence } from './fence.js';

export interface RecoverSessionExecutionsInput extends SessionReference {
  readonly expectedExecutionRevision: number;
}

/** Optional explicit operator recovery; not a timeout, heartbeat, or forced cancellation API. */
export interface SessionExecutionRecoveryPort {
  /**
   * CAS against execution occupancy, fence acquisition/writes and revoke old credentials first.
   * Reconcile interrupted Session-owned work before returning ready/idle Session evidence.
   * This does not recover other domains or authorize their work to resume. A composed runtime
   * must keep admission fenced across all participating domains until its recovery completes.
   * Partial failure remains recovering/busy and can be explicitly retried with fresh evidence.
   * Adapters serialize recovery ownership; CAS is not permission to run concurrent recoveries.
   */
  recoverSessionExecutions(input: RecoverSessionExecutionsInput): Promise<SessionExecutionFence>;
}
