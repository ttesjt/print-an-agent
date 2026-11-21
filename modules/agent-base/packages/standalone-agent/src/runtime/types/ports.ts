import type { AgentIdentity } from '@print-an-agent/base-identity-config/identity';
import type { RequestContextMemory, RequestJournalPort } from '@print-an-agent/base-request';
import type { CompactableSessionPort } from '@print-an-agent/base-session';
import type { StandaloneAgentConfig } from '../../configuration/index.js';
import type { StandaloneRuntimeOptions } from './options.js';

export interface StandaloneRuntimePorts {
  readonly session: CompactableSessionPort;
  readonly requestJournal: RequestJournalPort;
  readonly contextMemory?: RequestContextMemory;
  readonly contextMemoryToolAllowList?: readonly string[];
}

export interface StandaloneRuntimeMaterializationInput {
  readonly identity: AgentIdentity;
  readonly config: StandaloneAgentConfig;
  readonly ports: StandaloneRuntimePorts;
  readonly options: StandaloneRuntimeOptions;
}
