import type {
  ActorInvocationConfig,
  ActorInvocationPolicy,
  ActorInvocationPolicyInput,
} from '@ta-agent/base-actor';
import type {
  ComposeAgentOptions,
  DefinedProviderConfig,
  ProviderAgentAPI,
  ProviderConfigInput,
} from '@ta-agent/base-composition';
import type {
  AgentIdentity,
  AgentIdentityInput,
  AgentIdentitySnapshot,
} from '@ta-agent/base-identity';
import type {
  ProviderTransportLivenessPolicy,
  ProviderTransportLivenessPolicyInput,
} from '@ta-agent/base-model';
import type { RequestPolicy } from '@ta-agent/base-request';
import type { SessionCompactionPolicy } from '@ta-agent/base-session';
import type {
  StandaloneManagedSqliteTableNamingInput,
  StandaloneRuntimeSqliteTableNamingInput,
  StandaloneSharedSqliteTableNamingInput,
} from './resources/sqlite-table-naming.js';

export interface StandaloneCredentialBindingInput {
  readonly reference: string;
  readonly environmentVariable: string;
}

export type StandalonePersistenceConfigInput =
  | Readonly<{ kind: 'memory' }>
  | Readonly<{ kind: 'sqlite'; databasePath: string }>;

export interface StandaloneMainActorConfigInput {
  readonly instructions?: string;
  readonly invocationConfig?: ActorInvocationConfig;
  readonly invocationPolicy?: ActorInvocationPolicyInput;
}

export interface StandaloneMainActorConfig {
  readonly instructions?: string;
  readonly invocationConfig: ActorInvocationConfig;
  readonly invocationPolicy: ActorInvocationPolicy;
}

export interface StandaloneProviderConfigInput {
  readonly config: ProviderConfigInput;
  readonly transportLivenessPolicy?: ProviderTransportLivenessPolicyInput;
}

export interface StandaloneProviderConfig {
  readonly config: DefinedProviderConfig;
  readonly transportLivenessPolicy: ProviderTransportLivenessPolicy;
}

export interface StandaloneRequestExecutionConfigInput {
  readonly timeoutMilliseconds: RequestPolicy['timeoutMilliseconds'];
}

export interface StandaloneRequestExecutionConfig {
  readonly timeoutMilliseconds: RequestPolicy['timeoutMilliseconds'];
}

export interface StandaloneSessionCompactionExecutionConfigInput {
  readonly timeoutMilliseconds: SessionCompactionPolicy['timeoutMilliseconds'];
}

export interface StandaloneSessionCompactionExecutionConfig {
  readonly timeoutMilliseconds: SessionCompactionPolicy['timeoutMilliseconds'];
}

export interface StandaloneAgentConfigInput {
  readonly schemaVersion: 1;
  readonly identity: AgentIdentityInput;
  readonly provider: StandaloneProviderConfigInput;
  readonly credential?: StandaloneCredentialBindingInput;
  readonly persistence: StandalonePersistenceConfigInput;
  readonly mainActor?: StandaloneMainActorConfigInput;
  readonly request?: StandaloneRequestExecutionConfigInput;
  readonly sessionCompaction?: StandaloneSessionCompactionExecutionConfigInput;
}

export type StandalonePersistenceConfig =
  | Readonly<{ kind: 'memory' }>
  | Readonly<{ kind: 'sqlite'; databasePath: string }>;

export interface StandaloneAgentConfig {
  readonly schemaVersion: 1;
  readonly identity: AgentIdentity;
  readonly provider: StandaloneProviderConfig;
  readonly credential?: Readonly<StandaloneCredentialBindingInput>;
  readonly persistence: StandalonePersistenceConfig;
  readonly mainActor: StandaloneMainActorConfig;
  readonly request: StandaloneRequestExecutionConfig;
  readonly sessionCompaction: StandaloneSessionCompactionExecutionConfig;
}

export interface StandaloneCredentialRuntimeOptions {
  readonly readEnvironmentVariable: (name: string) => string | undefined;
}

export interface StandaloneRuntimeOptions extends StandaloneCredentialRuntimeOptions {
  /** Executable host composition, never part of durable Agent JSON configuration. */
  readonly stepOverrides?: ComposeAgentOptions['stepOverrides'];
  /** Non-timeout Request limits; durable Agent configuration owns the timeout. */
  readonly requestLimits?: Omit<RequestPolicy, 'timeoutMilliseconds'>;
}

export interface CreateStandaloneAgentOptions extends StandaloneRuntimeOptions {
  readonly sqlite?: StandaloneRuntimeSqliteTableNamingInput;
}

export type StandaloneAgent = ProviderAgentAPI;

export interface StandaloneAgentDefinitionInput {
  readonly provider: StandaloneProviderConfigInput;
  readonly credential?: StandaloneCredentialBindingInput;
  readonly mainActor?: StandaloneMainActorConfigInput;
  readonly request?: StandaloneRequestExecutionConfigInput;
  readonly sessionCompaction?: StandaloneSessionCompactionExecutionConfigInput;
}

export interface StandaloneAgentDefinition {
  readonly provider: StandaloneProviderConfig;
  readonly credential?: Readonly<StandaloneCredentialBindingInput>;
  readonly mainActor: StandaloneMainActorConfig;
  readonly request: StandaloneRequestExecutionConfig;
  readonly sessionCompaction: StandaloneSessionCompactionExecutionConfig;
}

export interface StandaloneAgentManifestInput {
  readonly schemaVersion: 1;
  readonly identity: AgentIdentityInput;
  readonly config: StandaloneAgentDefinitionInput;
}

export interface StandaloneAgentManifest {
  readonly schemaVersion: 1;
  readonly identity: AgentIdentity;
  readonly config: StandaloneAgentDefinition;
}

export type StandaloneManifestProjectionStatus = 'current' | 'stale';

export interface ManagedStandaloneAgentSnapshot {
  readonly identity: AgentIdentitySnapshot;
  readonly config: StandaloneAgentDefinition;
  readonly configRevision: number;
  readonly manifestProjection: StandaloneManifestProjectionStatus;
}

export interface UpdateManagedStandaloneAgentConfigRequest {
  readonly agentId: string;
  readonly config: StandaloneAgentDefinitionInput;
  readonly expectedRevision: number;
}

export interface TransitionManagedStandaloneAgentRequest {
  readonly agentId: string;
  readonly expectedRevision: number;
}

export interface ManagedStandaloneAgentRegistry {
  create(manifest: unknown): Promise<ManagedStandaloneAgentSnapshot>;
  inspect(agentId: string): Promise<ManagedStandaloneAgentSnapshot>;
  list(): Promise<readonly ManagedStandaloneAgentSnapshot[]>;
  updateConfig(
    request: UpdateManagedStandaloneAgentConfigRequest
  ): Promise<ManagedStandaloneAgentSnapshot>;
  disable(
    request: TransitionManagedStandaloneAgentRequest
  ): Promise<ManagedStandaloneAgentSnapshot>;
  reactivate(
    request: TransitionManagedStandaloneAgentRequest
  ): Promise<ManagedStandaloneAgentSnapshot>;
  open(agentId: string): Promise<StandaloneAgent>;
}

export type StandaloneAgentDirectory = ManagedStandaloneAgentRegistry;

export interface CreateStandaloneAgentDirectoryOptions extends StandaloneRuntimeOptions {
  readonly rootDirectory: string;
  readonly clock?: () => number;
  readonly createTemporaryId?: () => string;
  readonly sqlite?: StandaloneManagedSqliteTableNamingInput;
}

export interface CreateSharedSqliteStandaloneAgentRegistryOptions extends StandaloneRuntimeOptions {
  readonly databasePath: string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
  readonly sqlite?: StandaloneSharedSqliteTableNamingInput;
}
