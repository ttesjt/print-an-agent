import type { AgentConfigSnapshot, AgentManagementResult, AgentRevision } from './agent-types.js';

export interface ReadAgentConfigInput {
  readonly agentId: string;
  readonly signal?: AbortSignal;
}

export interface UpdateAgentConfigInput<Config> {
  readonly agentId: string;
  readonly config: Config;
  readonly expectedRevision: AgentRevision;
  readonly signal?: AbortSignal;
}

export interface AgentConfigurationPort<Config> {
  readAgentConfig(
    input: ReadAgentConfigInput
  ): Promise<AgentManagementResult<AgentConfigSnapshot<Config>>>;
  updateAgentConfig(
    input: UpdateAgentConfigInput<Config>
  ): Promise<AgentManagementResult<AgentConfigSnapshot<Config>>>;
}
