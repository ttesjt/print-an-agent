import { AgentBaseStandaloneError } from '../../errors.js';

export interface MemoryAllocationBinding {
  readonly agentId: string;
  readonly allocationId: string;
}

export function parseAllocationBinding(input: unknown): MemoryAllocationBinding {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('agentId' in input) ||
    typeof input.agentId !== 'string' ||
    !('allocationId' in input) ||
    typeof input.allocationId !== 'string'
  ) {
    throw new AgentBaseStandaloneError('Memory allocation binding is invalid.', {
      code: 'STANDALONE_AGENT_STORAGE_INVALID',
    });
  }
  return { agentId: input.agentId, allocationId: input.allocationId };
}

export const describeAllocation = (binding: MemoryAllocationBinding) => ({
  key: binding.allocationId,
  descriptor: { agentId: binding.agentId, allocationId: binding.allocationId },
});
