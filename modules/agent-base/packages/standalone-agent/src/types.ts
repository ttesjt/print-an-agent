import type {
  ActorInvocationConfig,
  ActorInvocationPolicy,
  ActorInvocationPolicyInput,
} from '@ta-agent/model-invocation-core';
import type {
  ComposeAgentOptions,
  composeAgent,
  DefinedProviderConfig,
  ProviderConfigInput,
} from '@ta-agent/base-composition';
import type { AgentIdentity, AgentIdentityInput } from '@ta-agent/base-identity';
import type {
  ProviderTransportLivenessPolicy,
  ProviderTransportLivenessPolicyInput,
} from '@ta-agent/model-invocation-core';
import type { RequestPolicy } from '@ta-agent/base-request';
import type { SessionCompactionPolicy } from '@ta-agent/base-session';
import type {
  StandaloneManagedSqliteTableNamingInput,
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

export interface StandaloneAgentBootstrapConfigInput {
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

export interface StandaloneAgentBootstrapConfig {
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
  readonly sqlite?: StandaloneSharedSqliteTableNamingInput;
}

export type StandaloneRawAgent = ReturnType<typeof composeAgent>;

export interface StandaloneAgentConfigInput {
  readonly provider: StandaloneProviderConfigInput;
  readonly credential?: StandaloneCredentialBindingInput;
  readonly mainActor?: StandaloneMainActorConfigInput;
  readonly request?: StandaloneRequestExecutionConfigInput;
  readonly sessionCompaction?: StandaloneSessionCompactionExecutionConfigInput;
}

export interface StandaloneAgentConfig {
  readonly provider: StandaloneProviderConfig;
  readonly credential?: Readonly<StandaloneCredentialBindingInput>;
  readonly mainActor: StandaloneMainActorConfig;
  readonly request: StandaloneRequestExecutionConfig;
  readonly sessionCompaction: StandaloneSessionCompactionExecutionConfig;
}

export interface StandaloneAgentManifestInput {
  readonly schemaVersion: 1;
  readonly identity: AgentIdentityInput;
  readonly config: StandaloneAgentConfigInput;
}

export interface StandaloneAgentManifest {
  readonly schemaVersion: 1;
  readonly identity: AgentIdentity;
  readonly config: StandaloneAgentConfig;
}

export interface CreateStandaloneDirectoryProfileOptions extends StandaloneRuntimeOptions {
  readonly rootDirectory: string;
  readonly clock?: () => number;
  readonly createTemporaryId?: () => string;
  readonly sqlite?: StandaloneManagedSqliteTableNamingInput;
}

export interface CreateStandaloneMemoryProfileOptions extends StandaloneRuntimeOptions {
  readonly clock?: () => number;
}

export type CreateStandaloneDirectoryManagementServiceOptions = Omit<
  CreateStandaloneDirectoryProfileOptions,
  keyof StandaloneRuntimeOptions
>;

export type CreateStandaloneDirectorySessionServiceOptions =
  CreateStandaloneDirectoryManagementServiceOptions;

export type CreateStandaloneDirectoryNavigationServiceOptions =
  CreateStandaloneDirectoryManagementServiceOptions;

export interface CreateSharedSqliteStandaloneProfileOptions extends StandaloneRuntimeOptions {
  readonly databasePath: string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
  readonly sqlite?: StandaloneSharedSqliteTableNamingInput;
}

export type CreateSharedSqliteStandaloneManagementServiceOptions = Omit<
  CreateSharedSqliteStandaloneProfileOptions,
  keyof StandaloneRuntimeOptions
>;

export type CreateSharedSqliteStandaloneSessionServiceOptions =
  CreateSharedSqliteStandaloneManagementServiceOptions;

export type CreateSharedSqliteStandaloneNavigationServiceOptions =
  CreateSharedSqliteStandaloneManagementServiceOptions;
