import type { ResourceRequest } from './token.js';
import type { ResourceExternalBinding } from './bindings.js';

export type ResourceScopeState = 'open' | 'fenced' | 'closing' | 'closed' | 'close-failed';
export interface ResourceCallOptions {
  readonly signal?: AbortSignal;
}
export interface ResourceCloseOptions {
  readonly mode?: 'drain' | 'abort';
}
export interface ResourceScopeOptions {
  readonly bindings?: readonly ResourceExternalBinding[];
}
export interface ResourceAcquisition<T> {
  /** A capability, Service or Bundle. Acquiring a reference does not transfer ownership. */
  readonly value: T;
  /**
   * Releases only this acquisition. Retained dependencies need declared Provider edges or explicit
   * external ownership; capturing a resolver/reference does not record a lifecycle dependency.
   */
  readonly release?: () => void | Promise<void>;
}

/**
 * Composition-level lookup/creation through a fixed Blueprint, not a Workflow resource contract.
 * Profile-specific provisioning Services may hold this interface. Generic application Services
 * normally request narrow capabilities from Definition factories/resolvers instead of knowing
 * Profile Tokens/bindings. Neither kind of Service gains Scope ownership by resolving a value.
 */
export interface ResourceRegistry {
  /** Does not initialize a missing resource. A supplied external value still requires validation. */
  lookup<B, V>(
    request: ResourceRequest<B, V>,
    options?: ResourceCallOptions
  ): Promise<V | undefined>;
  /** Creates on demand only through the already-declared Provider; no caller-selected fallback. */
  resolve<B, V>(request: ResourceRequest<B, V>, options?: ResourceCallOptions): Promise<V>;
}

/** Host/Profile-owned lifetime; tracks initialization and acquisitions, not arbitrary business Runs. */
export interface ResourceScope {
  readonly registry: ResourceRegistry;
  readonly state: ResourceScopeState;
  close(options?: ResourceCloseOptions): Promise<void>;
}
