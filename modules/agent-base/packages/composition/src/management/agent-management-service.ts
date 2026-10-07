import {
  createManagedAgent,
  importManagedAgentConfig,
  inspectManagedAgent,
  listManagedAgents,
  transitionManagedAgent,
  updateManagedAgentConfig,
} from './agent-management-operations.js';
import type { AgentId } from '@ta-agent/base-identity';
import type {
  AgentManagementService,
  CreateManagedAgentRequest,
  ImportManagedAgentConfigRequest,
  TransitionManagedAgentRequest,
  UpdateManagedAgentConfigRequest,
} from './contracts/agent-management.js';
import type { ManagedAgentCompositionDefinition } from './definition.js';
import { runManagementOperation } from './failures.js';
import { renameManagedAgent } from './agent-metadata-operations.js';
import type { RenameManagedAgentRequest } from './contracts/agent-management.js';

export function createAgentManagementService<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  definition: ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>
): AgentManagementService<TConfig> {
  return Object.freeze({
    rename: (request: RenameManagedAgentRequest) =>
      runManagementOperation('rename', () => renameManagedAgent(definition, request)),
    create: (request: CreateManagedAgentRequest<TConfig>) =>
      runManagementOperation('create', () => createManagedAgent(definition, request)),
    inspect: (agentId: AgentId) =>
      runManagementOperation('inspect', () => inspectManagedAgent(definition, agentId)),
    list: () => runManagementOperation('list', () => listManagedAgents(definition)),
    updateConfig: (request: UpdateManagedAgentConfigRequest<TConfig>) =>
      runManagementOperation('update-config', () =>
        updateManagedAgentConfig('update-config', definition, request)
      ),
    importConfig: (request: ImportManagedAgentConfigRequest) =>
      runManagementOperation('import-config', () => importManagedAgentConfig(definition, request)),
    disable: (request: TransitionManagedAgentRequest) =>
      runManagementOperation('disable', () =>
        transitionManagedAgent('disable', definition, request)
      ),
    reactivate: (request: TransitionManagedAgentRequest) =>
      runManagementOperation('reactivate', () =>
        transitionManagedAgent('reactivate', definition, request)
      ),
  });
}
