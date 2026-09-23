import type { CoordinatedSessionMaintenance } from '@ta-agent/base-local-adapters';
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
  SessionLifecyclePort,
  SessionLifecycleQueryPort,
  SessionLifecycleSnapshot,
  SessionTurnPage,
} from '@ta-agent/base-session';
import type {
  AgentResourceNamespace,
  AgentResourceNamespaceAdapter,
} from '../managed-agent/contracts.js';

export interface ManagedStandaloneSessionPorts {
  readonly session: SessionLifecycleQueryPort & SessionLifecyclePort;
  readonly maintenance: CoordinatedSessionMaintenance;
}

export interface ManagedStandaloneSessionPortFactory<TNamespace> {
  createSessionManagementPorts(
    namespace: AgentResourceNamespace<TNamespace>
  ): ManagedStandaloneSessionPorts;
}

export interface CreateManagedStandaloneSessionServiceOptions<TNamespace> {
  readonly namespaces: Pick<AgentResourceNamespaceAdapter<TNamespace>, 'resolve'>;
  readonly ports: ManagedStandaloneSessionPortFactory<TNamespace>;
}

export interface ManagedSessionReference {
  readonly agentId: string;
  readonly sessionId: string;
}

export interface ManagedSessionListInput extends Omit<ListSessionsInput, 'agentId'> {
  readonly agentId: string;
}

export interface ManagedRetiredSessionListInput extends Omit<ListRetiredSessionsInput, 'agentId'> {
  readonly agentId: string;
}

export interface ManagedSessionTurnListInput
  extends Omit<ListSessionTurnsInput, 'agentId' | 'sessionId'>, ManagedSessionReference {}

export interface ManagedSessionMutationInput extends ManagedSessionReference {
  readonly expectedRevision: number;
}

export interface ManagedSessionPurgeInput
  extends ManagedSessionMutationInput, Pick<PurgeSessionInput, 'confirmation'> {}

export interface ManagedSessionRecoveryInput
  extends
    ManagedSessionReference,
    Pick<RecoverSessionExecutionsInput, 'expectedExecutionRevision'> {}

/** Management plane for an existing Agent namespace; no runtime Agent construction. */
export interface ManagedStandaloneSessionService {
  list(input: ManagedSessionListInput): Promise<SessionLifecycleListPage>;
  listRetired(input: ManagedRetiredSessionListInput): Promise<RetiredSessionListPage>;
  inspect(reference: ManagedSessionReference): Promise<SessionLifecycleInspection | undefined>;
  listTurns(input: ManagedSessionTurnListInput): Promise<SessionTurnPage | undefined>;
  retire(input: ManagedSessionMutationInput): Promise<SessionLifecycleSnapshot>;
  restore(input: ManagedSessionMutationInput): Promise<SessionLifecycleSnapshot>;
  purge(input: ManagedSessionPurgeInput): Promise<void>;
  recover(input: ManagedSessionRecoveryInput): Promise<SessionExecutionFence>;
}
