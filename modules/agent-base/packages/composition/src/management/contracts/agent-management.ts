import type { AgentId, AgentIdentityInput, AgentIdentitySnapshot } from '@ta-agent/base-identity';
import type { AgentConfigProjectionStatus } from './projection.js';

export interface CreateManagedAgentRequest<TConfig> {
  readonly identity: AgentIdentityInput;
  readonly config: TConfig;
}

export interface UpdateManagedAgentConfigRequest<TConfig> {
  readonly agentId: AgentId;
  readonly config: TConfig;
  readonly expectedRevision: number;
}

export interface ImportManagedAgentConfigRequest {
  readonly agentId: AgentId;
  readonly input: unknown;
  readonly expectedRevision: number;
}

export interface TransitionManagedAgentRequest {
  readonly agentId: AgentId;
  readonly expectedIdentityRevision: number;
}

export interface ManagedAgentConfigSnapshot<TConfig> {
  readonly value: TConfig;
  readonly revision: number;
}

export interface ManagedAgentSnapshot<TConfig> {
  readonly identity: AgentIdentitySnapshot;
  readonly config: ManagedAgentConfigSnapshot<TConfig>;
  readonly projection: AgentConfigProjectionStatus;
}

export interface AgentManagementService<TConfig> {
  create(request: CreateManagedAgentRequest<TConfig>): Promise<ManagedAgentSnapshot<TConfig>>;
  inspect(agentId: AgentId): Promise<ManagedAgentSnapshot<TConfig>>;
  list(): Promise<readonly ManagedAgentSnapshot<TConfig>[]>;
  updateConfig(
    request: UpdateManagedAgentConfigRequest<TConfig>
  ): Promise<ManagedAgentSnapshot<TConfig>>;
  importConfig(request: ImportManagedAgentConfigRequest): Promise<ManagedAgentSnapshot<TConfig>>;
  disable(request: TransitionManagedAgentRequest): Promise<ManagedAgentSnapshot<TConfig>>;
  reactivate(request: TransitionManagedAgentRequest): Promise<ManagedAgentSnapshot<TConfig>>;
}
