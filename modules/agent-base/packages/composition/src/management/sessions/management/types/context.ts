import type { ManagedAgentNamespacePort } from '../../../namespace/index.js';
import type { SessionManagementCapability, SessionManagementPorts } from './ports.js';

export type SessionManagedDefinition<TNamespaceHandle> = Readonly<{
  namespace: Readonly<{ port: ManagedAgentNamespacePort<TNamespaceHandle> }>;
}> &
  SessionManagementCapability<TNamespaceHandle, SessionManagementPorts>;
