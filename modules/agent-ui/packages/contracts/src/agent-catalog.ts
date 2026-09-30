export type AgentLifecycleStatus = 'active' | 'disabled';

export interface AgentSummary {
  readonly agentId: string;
  readonly displayName: string;
  readonly status: AgentLifecycleStatus;
}

export interface ListAgentsOptions {
  readonly signal?: AbortSignal;
}

export interface AgentCatalogPort {
  listAgents(options?: ListAgentsOptions): Promise<readonly AgentSummary[]>;
}
