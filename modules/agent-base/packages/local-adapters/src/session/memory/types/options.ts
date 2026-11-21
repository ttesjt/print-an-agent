export interface MemorySessionAdapterOptions {
  /** Must issue fresh, never-reused IDs, including across restarts of the owning application. */
  readonly createSessionId?: () => string;
  readonly createBranchId?: () => string;
  readonly clock?: () => number;
}
