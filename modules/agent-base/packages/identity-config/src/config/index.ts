export { resolveAgentConfig, writeAgentConfig } from './lib/agent-config.js';
export { normalizeConfigValue } from './lib/config-value.js';
export { AgentConfigError } from './types/errors.js';
export type {
  AgentConfigWriteRequest,
  AgentConfigReadAdapter,
  AgentConfigWriteAdapter,
} from './types/adapter.js';
export type {
  ConfigValue,
  AgentConfigCodec,
  AgentConfigSnapshot,
  ResolvedAgentConfig,
  ResolveAgentConfigOptions,
  WriteAgentConfigOptions,
} from './types/config.js';
