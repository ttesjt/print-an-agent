import type { ActorInvocationConfig } from '@ta-agent/base-actor';
import type { ProviderAgentAPI, ProviderConfigInput } from '@ta-agent/base-composition';
import type { AgentIdentity, AgentIdentityInput } from '@ta-agent/base-identity';

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

export interface CreateStandaloneAgentOptions {
  readonly readEnvironmentVariable: (name: string) => string | undefined;
}

export type StandaloneAgent = ProviderAgentAPI;
