import type { SessionReference } from '../../../contracts/index.js';
import type { SessionExecutionLease } from './lease.js';

export interface SessionExecutionPort {
  /**
   * Atomic with retirement. Multiple leases may coexist; branch concurrency is a separate rule.
   * Lease IDs must never be reused within a Session. There is no time-based expiration.
   */
  acquireSessionExecution(reference: SessionReference): Promise<SessionExecutionLease>;
  /**
   * The caller retains occupancy through its entire execution and finalization, including replay.
   * The Session adapter does not inspect or finalize resources owned by the caller's other ports.
   * Releasing a lease never erases unresolved work or reactivates an invalid credential.
   * Session reference and lifecycle checks retain their documented precedence. For an active,
   * ready Session, unknown/released/revoked credentials fail with SESSION_EXECUTION_STALE; no
   * silent rebinding.
   */
  releaseSessionExecution(lease: SessionExecutionLease): Promise<void>;
}
