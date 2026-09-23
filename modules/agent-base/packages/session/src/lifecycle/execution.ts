import type { SessionReference } from '../types.js';

declare const executionBrand: unique symbol;

export type SessionExecutionId = string & { readonly [executionBrand]: 'SessionExecutionId' };

/** Adapter-issued and registered authority. Parsing a value does not grant execution rights. */
export interface SessionExecutionLease extends SessionReference {
  readonly executionId: SessionExecutionId;
}

/** Lifecycle-capable adapters require registered execution authority for every runtime write. */
export interface SessionWriteAuthority {
  readonly execution?: SessionExecutionLease;
}

export function supportsSessionExecution(value: object): value is SessionExecutionPort {
  return (
    'acquireSessionExecution' in value &&
    typeof value.acquireSessionExecution === 'function' &&
    'releaseSessionExecution' in value &&
    typeof value.releaseSessionExecution === 'function'
  );
}

/** Trusted adapter evidence; counts are not caller assertions that a Session is idle. */
export interface SessionExecutionFence {
  /** Advances on every occupancy/recovery change, independently of metadataRevision. */
  readonly revision: number;
  readonly state: 'ready' | 'recovering';
  readonly activeLeaseCount: number;
  /** Unsettled Session-owned work, including Turns whose execution credential was revoked. */
  readonly pendingWorkCount: number;
}

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
