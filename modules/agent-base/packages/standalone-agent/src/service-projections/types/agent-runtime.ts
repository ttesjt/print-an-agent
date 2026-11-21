import type { StandaloneRawAgent } from '../../runtime/index.js';

export interface StandaloneAgentRuntimeService {
  open(agentId: string): Promise<StandaloneRawAgent>;
}
