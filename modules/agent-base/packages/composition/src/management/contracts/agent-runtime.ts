import type { AgentId } from '@print-an-agent/base-identity';
import type { RawManagedAgent } from './runtime.js';

/** Materializes independent raw Agent instances from published managed authority. */
export interface AgentRuntimeService<TAgent> {
  open(agentId: AgentId): Promise<RawManagedAgent<TAgent>>;
}
