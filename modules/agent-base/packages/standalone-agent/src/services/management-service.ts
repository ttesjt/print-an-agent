import type {
  AgentManagementService,
  ImportManagedAgentConfigRequest,
  ManagedAgentSnapshot,
} from '@ta-agent/base-composition';
import { parseAgentId, type AgentIdentityInput } from '@ta-agent/base-identity';
import { defineStandaloneAgentConfig } from '../config.js';
import type { StandaloneAgentConfig, StandaloneAgentConfigInput } from '../types.js';

export interface StandaloneAgentManagementService {
  create(
    request: Readonly<{
      identity: AgentIdentityInput;
      config: StandaloneAgentConfigInput;
    }>
  ): Promise<ManagedAgentSnapshot<StandaloneAgentConfig>>;
  inspect(agentId: string): Promise<ManagedAgentSnapshot<StandaloneAgentConfig>>;
  list(): Promise<readonly ManagedAgentSnapshot<StandaloneAgentConfig>[]>;
  updateConfig(
    request: Readonly<{
      agentId: string;
      config: StandaloneAgentConfigInput;
      expectedRevision: number;
    }>
  ): Promise<ManagedAgentSnapshot<StandaloneAgentConfig>>;
  importConfig(
    request: Omit<ImportManagedAgentConfigRequest, 'agentId'> & Readonly<{ agentId: string }>
  ): Promise<ManagedAgentSnapshot<StandaloneAgentConfig>>;
  disable(
    request: Readonly<{
      agentId: string;
      expectedIdentityRevision: number;
    }>
  ): Promise<ManagedAgentSnapshot<StandaloneAgentConfig>>;
  reactivate(
    request: Readonly<{
      agentId: string;
      expectedIdentityRevision: number;
    }>
  ): Promise<ManagedAgentSnapshot<StandaloneAgentConfig>>;
}

/** Projects branded generic management onto the Standalone host/JSON boundary. */
export function projectStandaloneAgentManagementService(
  service: AgentManagementService<StandaloneAgentConfig>
): StandaloneAgentManagementService {
  return Object.freeze({
    create: (request: Parameters<StandaloneAgentManagementService['create']>[0]) =>
      service.create({
        identity: request.identity,
        config: defineStandaloneAgentConfig(request.config),
      }),
    inspect: (agentId: string) => service.inspect(parseAgentId(agentId)),
    list: () => service.list(),
    updateConfig: (request: Parameters<StandaloneAgentManagementService['updateConfig']>[0]) =>
      service.updateConfig({
        agentId: parseAgentId(request.agentId),
        config: defineStandaloneAgentConfig(request.config),
        expectedRevision: request.expectedRevision,
      }),
    importConfig: (request: Parameters<StandaloneAgentManagementService['importConfig']>[0]) =>
      service.importConfig({
        agentId: parseAgentId(request.agentId),
        input: request.input,
        expectedRevision: request.expectedRevision,
      }),
    disable: (request: Parameters<StandaloneAgentManagementService['disable']>[0]) =>
      service.disable({
        agentId: parseAgentId(request.agentId),
        expectedIdentityRevision: request.expectedIdentityRevision,
      }),
    reactivate: (request: Parameters<StandaloneAgentManagementService['reactivate']>[0]) =>
      service.reactivate({
        agentId: parseAgentId(request.agentId),
        expectedIdentityRevision: request.expectedIdentityRevision,
      }),
  });
}
