import type { AgentDetails, AgentManagementResult, AgentRevision } from './agent-types.js';

export interface ChangeAgentLifecycleInput {
  readonly agentId: string;
  readonly expectedRevision: AgentRevision;
  readonly signal?: AbortSignal;
}

export interface AgentLifecyclePort {
  disableAgent(input: ChangeAgentLifecycleInput): Promise<AgentManagementResult<AgentDetails>>;
  reactivateAgent(input: ChangeAgentLifecycleInput): Promise<AgentManagementResult<AgentDetails>>;
}
