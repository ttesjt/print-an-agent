import type { StandaloneCredentialBindingInput } from './credential.js';
import type {
  StandaloneRequestExecutionConfig,
  StandaloneRequestExecutionConfigInput,
  StandaloneSessionCompactionExecutionConfig,
  StandaloneSessionCompactionExecutionConfigInput,
} from './execution.js';
import type { StandaloneMainActorConfig, StandaloneMainActorConfigInput } from './main-actor.js';
import type { StandaloneProviderConfig, StandaloneProviderConfigInput } from './provider.js';

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
