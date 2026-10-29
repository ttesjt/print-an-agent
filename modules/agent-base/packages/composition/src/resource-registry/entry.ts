import type { PreparedProvider } from './provider.js';
import type { ResourceTokenIdentity } from './token.js';

/** Attempts exist before factories run. The ready cache is not the ownership ledger. */
export interface ResourceEntry {
  readonly token: ResourceTokenIdentity;
  readonly prepared: PreparedProvider;
  readonly dependencies: Set<ResourceEntry>;
  readonly promise: Promise<unknown>;
  acquisition?: unknown;
  releaseCaptured?: boolean;
  releaseCallback?: () => unknown;
  releasePromise?: Promise<void>;
  cleanupFailure?: unknown;
}
