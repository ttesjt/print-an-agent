import type { StandaloneContextMemoryOptions } from './context.js';
import type { StandaloneRetrievalMemoryOptions } from './retrieval.js';

export interface StandaloneMemoryManagementOptions {
  /** Stable storage tenancy, not a path, Config revision, or host invocation ID. */
  readonly storageNamespaceId: string;
  readonly context?: StandaloneContextMemoryOptions;
  readonly retrieval?: StandaloneRetrievalMemoryOptions;
}
