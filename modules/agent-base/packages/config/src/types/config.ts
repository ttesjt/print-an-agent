import type { AgentId, AgentIdentity } from '@ta-agent/base-identity';

export type ConfigValue =
  | null
  | boolean
  | number
  | string
  | readonly ConfigValue[]
  | Readonly<{ [key: string]: ConfigValue }>;

export interface AgentConfigCodec<TConfig> {
  readonly schemaVersion: number;
  decode(value: unknown): TConfig;
  encode(config: TConfig): ConfigValue;
}

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

export interface ResolveAgentConfigOptions<TConfig> {
  readonly identity: AgentIdentity;
  readonly codec: AgentConfigCodec<TConfig>;
  readonly adapter: import('./adapter.js').AgentConfigReadAdapter;
  readonly createDefault?: () => TConfig;
}

export interface WriteAgentConfigOptions<TConfig> {
  readonly identity: AgentIdentity;
  readonly codec: AgentConfigCodec<TConfig>;
  readonly adapter: import('./adapter.js').AgentConfigWriteAdapter;
  readonly config: TConfig;
  readonly expectedRevision: number | null;
}
