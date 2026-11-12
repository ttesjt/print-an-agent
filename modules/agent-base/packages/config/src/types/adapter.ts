import type { AgentId } from '@print-an-agent/base-identity';
import type { AgentConfigSnapshot, ConfigValue } from './config.js';

export interface AgentConfigWriteRequest {
  readonly agentId: AgentId;
  readonly schemaVersion: number;
  readonly value: ConfigValue;
  readonly expectedRevision: number | null;
}

export interface AgentConfigReadAdapter {
  read(agentId: AgentId): Promise<AgentConfigSnapshot | undefined>;
}

export interface AgentConfigWriteAdapter extends AgentConfigReadAdapter {
  write(request: AgentConfigWriteRequest): Promise<AgentConfigSnapshot>;
}
