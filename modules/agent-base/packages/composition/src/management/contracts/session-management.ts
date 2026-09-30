import type { ManagedAgentNamespace } from './namespace.js';
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
  recoverSessionPersistence(input: RecoverSessionExecutionsInput): Promise<SessionExecutionFence>;
}

/** The exact out-of-band capabilities required by the standard Session management Service. */
export interface SessionManagementPorts {
  readonly session: SessionLifecycleQueryPort & SessionLifecyclePort;
  readonly maintenance: CoordinatedSessionMaintenancePort;
}

/** Creates product-owned out-of-band Session management ports for one Agent namespace. */
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
  list(input: ListSessionsInput): Promise<SessionLifecycleListPage>;
  listRetired(input: ListRetiredSessionsInput): Promise<RetiredSessionListPage>;
  inspect(reference: SessionReference): Promise<SessionLifecycleInspection | undefined>;
  listTurns(input: ListSessionTurnsInput): Promise<SessionTurnPage | undefined>;
  retire(input: SessionLifecycleMutationInput): Promise<SessionLifecycleSnapshot>;
  restore(input: SessionLifecycleMutationInput): Promise<SessionLifecycleSnapshot>;
  purge(input: PurgeSessionInput): Promise<void>;
  recover(input: RecoverSessionExecutionsInput): Promise<SessionExecutionFence>;
}
