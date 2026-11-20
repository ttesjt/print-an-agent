import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import { openManagedAgentRuntime } from './agent-runtime-operations.js';
import type { AgentRuntimeService } from './contracts/agent-runtime.js';
import type { ManagedAgentCompositionDefinition } from './definition.js';
import { runManagementOperation } from './failures.js';

/** Creates a zero-I/O Service that independently materializes one raw Agent per open call. */
export function createAgentRuntimeService<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  definition: ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>
): AgentRuntimeService<TAgent> {
  return Object.freeze({
    open: (agentId: AgentId) =>
      runManagementOperation('open', () => openManagedAgentRuntime(definition, agentId)),
  });
}
