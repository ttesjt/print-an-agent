import type { AgentDetails, AgentManagementResult, AgentRevision } from './agent-types.js';

export interface RenameAgentInput {
  readonly agentId: string;
  readonly displayName: string;
  readonly expectedRevision: AgentRevision;
  readonly signal?: AbortSignal;
}
/** Optional capability for applications that offer mutable display metadata, never mutable IDs. */
export interface AgentMetadataPort {
  renameAgent(input: RenameAgentInput): Promise<AgentManagementResult<AgentDetails>>;
}
