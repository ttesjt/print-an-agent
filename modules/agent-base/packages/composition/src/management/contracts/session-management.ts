import type { ManagedAgentNamespace } from './namespace.js';
import type { ManagementOperationOptions } from './operation.js';
import type {
  ListRetiredSessionsInput,
  ListSessionTurnsInput,
  ListSessionsInput,
  PurgeSessionInput,
  RecoverSessionExecutionsInput,
  RetiredSessionListPage,
  SessionExecutionFence,
  SessionLifecycleInspection,
  SessionLifecycleListPage,
  SessionLifecycleMutationInput,
  SessionLifecyclePort,
  SessionLifecycleQueryPort,
  SessionLifecycleSnapshot,
  SessionReference,
  SessionTurnPage,
} from '@ta-agent/base-session';

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

/** Out-of-band lifecycle management for Sessions owned by one published managed Agent. */
export interface SessionManagementService {
  list(
    input: ListSessionsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleListPage>;
  listRetired(
    input: ListRetiredSessionsInput,
    options?: ManagementOperationOptions
  ): Promise<RetiredSessionListPage>;
  inspect(
    reference: SessionReference,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleInspection | undefined>;
  listTurns(
    input: ListSessionTurnsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionTurnPage | undefined>;
  retire(
    input: SessionLifecycleMutationInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleSnapshot>;
  restore(
    input: SessionLifecycleMutationInput,
    options?: ManagementOperationOptions
  ): Promise<SessionLifecycleSnapshot>;
  purge(input: PurgeSessionInput, options?: ManagementOperationOptions): Promise<void>;
  recover(
    input: RecoverSessionExecutionsInput,
    options?: ManagementOperationOptions
  ): Promise<SessionExecutionFence>;
}
