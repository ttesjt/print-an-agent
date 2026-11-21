import type { AgentRuntimeService } from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import type { StandaloneRawAgent } from '../runtime/index.js';
import type { StandaloneAgentRuntimeService } from './types/agent-runtime.js';

export function projectStandaloneAgentRuntimeService(
  service: AgentRuntimeService<StandaloneRawAgent>
): StandaloneAgentRuntimeService {
  return Object.freeze({
    open: (agentId: string) => service.open(parseAgentId(agentId)),
  });
}
