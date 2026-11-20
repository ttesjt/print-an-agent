import type { AgentId, AgentIdentity } from '../../identity/index.js';
import type { ConfigValue } from './codec.js';

export interface AgentConfigSnapshot {
  readonly agentId: AgentId;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly value: ConfigValue;
}

export interface ResolvedAgentConfig<TConfig> {
  readonly identity: AgentIdentity;
  readonly config: TConfig;
  readonly source: 'default' | 'stored';
  readonly revision: number | null;
}
