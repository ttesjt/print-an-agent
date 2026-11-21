import type {
  AgentIdentity,
  AgentIdentityInput,
} from '@print-an-agent/base-identity-config/identity';
import type { StandaloneCredentialBindingInput } from './credential.js';
import type {
  StandaloneRequestExecutionConfig,
  StandaloneRequestExecutionConfigInput,
  StandaloneSessionCompactionExecutionConfig,
  StandaloneSessionCompactionExecutionConfigInput,
} from './execution.js';
import type { StandaloneMainActorConfig, StandaloneMainActorConfigInput } from './main-actor.js';
import type { StandaloneProviderConfig, StandaloneProviderConfigInput } from './provider.js';

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

export type StandalonePersistenceConfigInput =
  | Readonly<{ kind: 'memory' }>
  | Readonly<{ kind: 'sqlite'; databasePath: string }>;

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
