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
import type { ManagementOperationOptions } from './contracts/operation.js';
import { normalizeManagementOperationOptions } from './operation.js';

export function createAgentManagementService<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>(
  definition: ManagedAgentCompositionDefinition<TConfig, TNamespaceHandle, TRuntimePorts, TAgent>
): AgentManagementService<TConfig> {
  return Object.freeze({
    rename: (request: RenameManagedAgentRequest, options?: ManagementOperationOptions) => {
      return runManagementOperation('rename', () => {
        const { signal } = normalizeManagementOperationOptions('rename', options);
        return renameManagedAgent(definition, request, signal);
      });
    },
    create: (request: CreateManagedAgentRequest<TConfig>, options?: ManagementOperationOptions) => {
      return runManagementOperation('create', () => {
        const { signal } = normalizeManagementOperationOptions('create', options);
        return createManagedAgent(definition, request, signal);
      });
    },
    inspect: (agentId: AgentId, options?: ManagementOperationOptions) => {
      return runManagementOperation('inspect', () => {
        const { signal } = normalizeManagementOperationOptions('inspect', options);
        return inspectManagedAgent(definition, agentId, signal);
      });
    },
    list: (options?: ManagementOperationOptions) => {
      return runManagementOperation('list', () => {
        const { signal } = normalizeManagementOperationOptions('list', options);
        return listManagedAgents(definition, signal);
      });
    },
    updateConfig: (
      request: UpdateManagedAgentConfigRequest<TConfig>,
      options?: ManagementOperationOptions
    ) => {
      return runManagementOperation('update-config', () => {
        const { signal } = normalizeManagementOperationOptions('update-config', options);
        return updateManagedAgentConfig('update-config', definition, request, signal);
      });
    },
    importConfig: (
      request: ImportManagedAgentConfigRequest,
      options?: ManagementOperationOptions
    ) => {
      return runManagementOperation('import-config', () => {
        const { signal } = normalizeManagementOperationOptions('import-config', options);
        return importManagedAgentConfig(definition, request, signal);
      });
    },
    disable: (request: TransitionManagedAgentRequest, options?: ManagementOperationOptions) => {
      return runManagementOperation('disable', () => {
        const { signal } = normalizeManagementOperationOptions('disable', options);
        return transitionManagedAgent('disable', definition, request, signal);
      });
    },
    reactivate: (request: TransitionManagedAgentRequest, options?: ManagementOperationOptions) => {
      return runManagementOperation('reactivate', () => {
        const { signal } = normalizeManagementOperationOptions('reactivate', options);
        return transitionManagedAgent('reactivate', definition, request, signal);
      });
    },
  });
}
