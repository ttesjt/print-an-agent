import type { AgentManagementResult, AgentSnapshot, AgentSummary } from './agent-types.js';

export interface ListAgentsOptions {
  readonly signal?: AbortSignal;
}

export interface AgentCatalogPort {
  listAgents(options?: ListAgentsOptions): Promise<AgentManagementResult<readonly AgentSummary[]>>;
}

export interface InspectAgentInput {
  readonly agentId: string;
  readonly signal?: AbortSignal;
}

export interface AgentInspectionPort<Config> {
  inspectAgent(input: InspectAgentInput): Promise<AgentManagementResult<AgentSnapshot<Config>>>;
}
