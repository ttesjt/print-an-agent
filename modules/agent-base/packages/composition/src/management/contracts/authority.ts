import type { AgentConfigWriteAdapter } from '@print-an-agent/base-config';
import type { AgentIdentityCatalogPort } from '@print-an-agent/base-identity';
import type { ManagedAgentNamespaceReference } from './namespace.js';

/** Authoritative Identity and Config ports scoped to one managed Agent. */
export interface ManagedAgentAuthorityPorts {
  readonly identityCatalog: AgentIdentityCatalogPort;
  readonly config: AgentConfigWriteAdapter;
}

/**
 * Narrow Definition provisioning contract. Profile setup/staging may use a resource-resolution
 * Service/Registry to prepare authority; this factory returns those prepared Ports synchronously.
 * The generic Service neither chooses that recipe nor owns its Scope. Do not hide async acquisition.
 */
export type ManagedAgentAuthorityPortFactory<TNamespaceHandle> = (
  namespace: ManagedAgentNamespaceReference<TNamespaceHandle>
) => ManagedAgentAuthorityPorts;
