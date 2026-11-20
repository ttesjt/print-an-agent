import type { AgentConfigCodec } from '@print-an-agent/base-identity-config/config';
import type { ManagedAgentAuthorityPortFactory } from '../../authority/index.js';
import type { ManagedAgentNamespacePort } from '../../namespace/index.js';
import type { AgentConfigProjectionPort } from './projection.js';

export interface AgentManagementContext<C, N> {
  readonly config: Readonly<{ codec: AgentConfigCodec<C> }>;
  readonly namespace: Readonly<{ port: ManagedAgentNamespacePort<N> }>;
  readonly authority: Readonly<{ createPorts: ManagedAgentAuthorityPortFactory<N> }>;
  readonly projection?: Readonly<{ port: AgentConfigProjectionPort<N, C> }>;
}
