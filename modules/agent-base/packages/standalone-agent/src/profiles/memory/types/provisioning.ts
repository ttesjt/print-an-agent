import type { MemoryAuthorityFactory, MemorySessionPersistenceFactory } from './acquisition.js';

/** Shared construction recipe; runtime wiring is composed only by the outer Profile. */
export interface MemoryProvisioningOptions {
  readonly clock?: () => number;
  readonly acquireAuthority?: MemoryAuthorityFactory;
  readonly acquireSessionPersistence?: MemorySessionPersistenceFactory;
}
