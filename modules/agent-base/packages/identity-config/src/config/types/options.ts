import type { AgentIdentity } from '../../identity/index.js';
import type { AgentConfigCodec } from './codec.js';
import type { AgentConfigReadAdapter, AgentConfigWriteAdapter } from './adapter.js';

export interface ResolveAgentConfigOptions<TConfig> {
  readonly identity: AgentIdentity;
  readonly codec: AgentConfigCodec<TConfig>;
  readonly adapter: AgentConfigReadAdapter;
  readonly createDefault?: () => TConfig;
}

export interface WriteAgentConfigOptions<TConfig> {
  readonly identity: AgentIdentity;
  readonly codec: AgentConfigCodec<TConfig>;
  readonly adapter: AgentConfigWriteAdapter;
  readonly config: TConfig;
  readonly expectedRevision: number | null;
}
