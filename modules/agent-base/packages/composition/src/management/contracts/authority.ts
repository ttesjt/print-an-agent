import type { AgentConfigWriteAdapter } from '@ta-agent/base-config';
import type { AgentIdentityCatalogPort } from '@ta-agent/base-identity';
import type { ManagedAgentNamespaceReference } from './namespace.js';

/** Authoritative Identity and Config ports scoped to one managed Agent. */
export interface ManagedAgentAuthorityPorts {
  readonly identityCatalog: AgentIdentityCatalogPort;
  readonly config: AgentConfigWriteAdapter;
}

export type ManagedAgentAuthorityPortFactory<TNamespaceHandle> = (
  namespace: ManagedAgentNamespaceReference<TNamespaceHandle>
) => ManagedAgentAuthorityPorts;
