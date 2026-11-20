import type {
  PurgeSessionInput,
  RecoverSessionExecutionsInput,
  SessionExecutionFence,
  SessionLifecyclePort,
  SessionLifecycleQueryPort,
} from '@print-an-agent/base-session';
import type { ManagedAgentNamespace } from '../../../namespace/index.js';
import type { ManagementOperationOptions } from '../../../operation/index.js';

/** Explicit Session + Request Journal maintenance; never a Session-only success claim. */
export interface CoordinatedSessionMaintenancePort {
  purgeSessionPersistence(input: PurgeSessionInput): Promise<void>;
  recoverSessionPersistence(
    input: RecoverSessionExecutionsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionExecutionFence>;
}

/** The exact out-of-band capabilities required by the standard Session management Service. */
export interface SessionManagementPorts {
  readonly session: SessionLifecycleQueryPort & SessionLifecyclePort;
  readonly maintenance: CoordinatedSessionMaintenancePort;
}

/**
 * On-demand, namespace-bound provisioning for generic Session management. A Profile may implement
 * it with a resource-resolution Service/Registry; the caller borrows Ports, not their Scope.
 */
export type SessionManagementPortFactory<TNamespaceHandle, TSessionManagementPorts> = (
  namespace: ManagedAgentNamespace<TNamespaceHandle>
) => TSessionManagementPorts | Promise<TSessionManagementPorts>;

/** Optional typed capability; it is not a dynamic capability registry. */
export interface SessionManagementCapability<TNamespaceHandle, TSessionManagementPorts> {
  readonly sessionManagement: Readonly<{
    createPorts: SessionManagementPortFactory<TNamespaceHandle, TSessionManagementPorts>;
  }>;
}
