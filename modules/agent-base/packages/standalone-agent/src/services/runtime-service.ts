import type { AgentRuntimeService } from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import type { StandaloneRawAgent } from '../runtime/index.js';

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
