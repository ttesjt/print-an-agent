import type {
  AgentIdentity,
  AgentIdentityInput,
} from '@print-an-agent/base-identity-config/identity';
import type { StandaloneAgentConfig, StandaloneAgentConfigInput } from './agent.js';

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
