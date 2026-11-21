import type {
  AgentManagementService,
  ImportManagedAgentConfigRequest,
  ManagedAgentCommitResult,
  ManagedAgentSnapshot,
  ManagementOperationOptions,
} from '@print-an-agent/base-composition';
import {
  parseAgentId,
  type AgentIdentityInput,
} from '@print-an-agent/base-identity-config/identity';
import type { StandaloneAgentConfig, StandaloneAgentConfigInput } from '../configuration/index.js';
import { defineStandaloneAgentConfig } from '../configuration/index.js';

export interface StandaloneAgentManagementService {
  create(
    request: Readonly<{
      identity: AgentIdentityInput;
      config: StandaloneAgentConfigInput;
    }>,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<StandaloneAgentConfig>>;
  inspect(
    agentId: string,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentSnapshot<StandaloneAgentConfig>>;
  list(
    options?: ManagementOperationOptions
  ): Promise<readonly ManagedAgentSnapshot<StandaloneAgentConfig>[]>;
  updateConfig(
    request: Readonly<{
      agentId: string;
      config: StandaloneAgentConfigInput;
      expectedRevision: number;
    }>,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<StandaloneAgentConfig>>;
  importConfig(
    request: Omit<ImportManagedAgentConfigRequest, 'agentId'> & Readonly<{ agentId: string }>,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<StandaloneAgentConfig>>;
  disable(
    request: Readonly<{
      agentId: string;
      expectedIdentityRevision: number;
    }>,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<StandaloneAgentConfig>>;
  reactivate(
    request: Readonly<{
      agentId: string;
      expectedIdentityRevision: number;
    }>,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<StandaloneAgentConfig>>;
}

/** Projects branded generic management onto the Standalone host/JSON boundary. */
export function projectStandaloneAgentManagementService(
  service: AgentManagementService<StandaloneAgentConfig>
): StandaloneAgentManagementService {
  const projected: StandaloneAgentManagementService = {
    create: (request, options) =>
      service.create(
        {
          identity: request.identity,
          config: defineStandaloneAgentConfig(request.config),
        },
        options
      ),
    inspect: (agentId, options) => service.inspect(parseAgentId(agentId), options),
    list: (options) => service.list(options),
    updateConfig: (request, options) =>
      service.updateConfig(
        {
          agentId: parseAgentId(request.agentId),
          config: defineStandaloneAgentConfig(request.config),
          expectedRevision: request.expectedRevision,
        },
        options
      ),
    importConfig: (request, options) =>
      service.importConfig(
        {
          agentId: parseAgentId(request.agentId),
          input: request.input,
          expectedRevision: request.expectedRevision,
        },
        options
      ),
    disable: (request, options) =>
      service.disable(
        {
          agentId: parseAgentId(request.agentId),
          expectedIdentityRevision: request.expectedIdentityRevision,
        },
        options
      ),
    reactivate: (request, options) =>
      service.reactivate(
        {
          agentId: parseAgentId(request.agentId),
          expectedIdentityRevision: request.expectedIdentityRevision,
        },
        options
      ),
  };
  return Object.freeze(projected);
}
