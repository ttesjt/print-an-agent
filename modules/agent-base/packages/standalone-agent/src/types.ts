import type {
  MemoryAuthorityFactory,
  MemorySessionPersistenceFactory,
} from './resources/memory/contracts.js';
import type { StandaloneRuntimeOptions } from './runtime/index.js';

export interface CreateStandaloneMemoryProfileOptions extends StandaloneRuntimeOptions {
  readonly clock?: () => number;
  /** Allocation authority is prepared before stage returns; never supplied by a business Run. */
  readonly acquireAuthority?: MemoryAuthorityFactory;
  /** Profile recipe, fixed at setup construction. Each allocation owns its acquisition. */
  readonly acquireSessionPersistence?: MemorySessionPersistenceFactory;
}
