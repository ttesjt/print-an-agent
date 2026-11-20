import type { SessionNavigationCoordinatorPort } from '@print-an-agent/base-session';
import type { ManagedAgentNamespace } from '../../../namespace/index.js';

/** The exact out-of-band capability required by the standard Session navigation Service. */
export interface SessionNavigationPorts {
  readonly session: SessionNavigationCoordinatorPort;
}

/** Creates product-owned out-of-band Session navigation ports for one Agent namespace. */
export type SessionNavigationPortFactory<TNamespaceHandle, TSessionNavigationPorts> = (
  namespace: ManagedAgentNamespace<TNamespaceHandle>
) => TSessionNavigationPorts | Promise<TSessionNavigationPorts>;

/** Optional typed capability; it neither requires nor implies Session management. */
export interface SessionNavigationCapability<TNamespaceHandle, TSessionNavigationPorts> {
  readonly sessionNavigation: Readonly<{
    createPorts: SessionNavigationPortFactory<TNamespaceHandle, TSessionNavigationPorts>;
  }>;
}
