import type { AgentIdentityDraft, AgentManagementResult, AgentSnapshot } from './agent-types.js';

export interface CreateAgentInput<Config> {
  readonly config: Config;
  readonly identity: AgentIdentityDraft;
  readonly signal?: AbortSignal;
}

export interface AgentCreationPort<Config> {
  createAgent(
    input: CreateAgentInput<Config>
  ): Promise<AgentManagementResult<AgentSnapshot<Config>>>;
}
