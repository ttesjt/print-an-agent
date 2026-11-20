import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import type { NavigateSessionInput } from '@print-an-agent/base-session';
import type { ManagedAgentNamespacePort } from '../../../namespace/index.js';
import type { SessionNavigationCapability, SessionNavigationPorts } from './ports.js';

export type SessionNavigationDefinition<TNamespaceHandle> = Readonly<{
  namespace: Readonly<{ port: ManagedAgentNamespacePort<TNamespaceHandle> }>;
}> &
  SessionNavigationCapability<TNamespaceHandle, SessionNavigationPorts>;

export interface PreparedNavigationRequest {
  readonly agentId: AgentId;
  readonly navigation: NavigateSessionInput;
}
