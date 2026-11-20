import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import type { ManagedAgentCompositionDefinition } from '../definition/index.js';
import {
  type AgentRuntimeService,
  openManagedAgentRuntime,
} from '../runtime-materialization/index.js';
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
