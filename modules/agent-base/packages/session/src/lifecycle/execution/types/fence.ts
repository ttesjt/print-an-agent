/** Trusted adapter evidence; counts are not caller assertions that a Session is idle. */
export interface SessionExecutionFence {
  /** Advances on every occupancy/recovery change, independently of metadataRevision. */
  readonly revision: number;
  readonly state: 'ready' | 'recovering';
  readonly activeLeaseCount: number;
  /** Unsettled Session-owned work, including Turns whose execution credential was revoked. */
  readonly pendingWorkCount: number;
}
