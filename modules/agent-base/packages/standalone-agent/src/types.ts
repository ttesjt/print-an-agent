import type { ActorInvocationConfig } from '@ta-agent/base-actor';
import type { ProviderAgentAPI, ProviderConfigInput } from '@ta-agent/base-composition';
import type {
  AgentIdentity,
  AgentIdentityInput,
  AgentIdentitySnapshot,
} from '@ta-agent/base-identity';
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
}

export interface StandaloneAgentConfigInput {
  readonly schemaVersion: 1;
  readonly identity: AgentIdentityInput;
  readonly provider: ProviderConfigInput;
  readonly credential?: StandaloneCredentialBindingInput;
  readonly persistence: StandalonePersistenceConfigInput;
  readonly mainActor?: StandaloneMainActorConfigInput;
}

export interface StandaloneMainActorConfig {
  readonly instructions?: string;
  readonly invocationConfig: ActorInvocationConfig;
}

export type StandalonePersistenceConfig =
  | Readonly<{ kind: 'memory' }>
  | Readonly<{ kind: 'sqlite'; databasePath: string }>;

export interface StandaloneAgentConfig {
  readonly schemaVersion: 1;
  readonly identity: AgentIdentity;
  readonly provider: ProviderConfigInput;
  readonly credential?: Readonly<StandaloneCredentialBindingInput>;
  readonly persistence: StandalonePersistenceConfig;
  readonly mainActor?: StandaloneMainActorConfig;
}

export interface StandaloneCredentialRuntimeOptions {
  readonly readEnvironmentVariable: (name: string) => string | undefined;
}

export interface CreateStandaloneAgentOptions extends StandaloneCredentialRuntimeOptions {
  readonly sqlite?: StandaloneRuntimeSqliteTableNamingInput;
}

export type StandaloneAgent = ProviderAgentAPI;

export interface StandaloneAgentDefinitionInput {
  readonly provider: ProviderConfigInput;
  readonly credential?: StandaloneCredentialBindingInput;
  readonly mainActor?: StandaloneMainActorConfigInput;
}

export interface StandaloneAgentDefinition {
  readonly provider: ProviderConfigInput;
  readonly credential?: Readonly<StandaloneCredentialBindingInput>;
  readonly mainActor?: StandaloneMainActorConfig;
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

export interface CreateStandaloneAgentDirectoryOptions extends StandaloneCredentialRuntimeOptions {
  readonly rootDirectory: string;
  readonly clock?: () => number;
  readonly createTemporaryId?: () => string;
  readonly sqlite?: StandaloneManagedSqliteTableNamingInput;
}

export interface CreateSharedSqliteStandaloneAgentRegistryOptions extends StandaloneCredentialRuntimeOptions {
  readonly databasePath: string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
  readonly sqlite?: StandaloneSharedSqliteTableNamingInput;
}
