import type { AgentRuntimeService } from '@ta-agent/base-composition';
import { parseAgentId } from '@ta-agent/base-identity';
import type { StandaloneRawAgent } from '../types.js';

export interface StandaloneAgentRuntimeService {
  open(agentId: string): Promise<StandaloneRawAgent>;
}

export function projectStandaloneAgentRuntimeService(
  service: AgentRuntimeService<StandaloneRawAgent>
): StandaloneAgentRuntimeService {
  return Object.freeze({
    open: (agentId: string) => service.open(parseAgentId(agentId)),
  });
}
