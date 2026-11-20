import type { AgentId, AgentIdentityInput } from '@print-an-agent/base-identity-config/identity';
import type { ManagedAgentAuthoritySnapshot } from '../../authority/index.js';
import type { ManagementOperationOptions } from '../../operation/index.js';
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

export interface RenameManagedAgentRequest extends TransitionManagedAgentRequest {
  readonly displayName: string;
}

export interface ManagedAgentSnapshot<TConfig> extends ManagedAgentAuthoritySnapshot<TConfig> {
  readonly projection: AgentConfigProjectionStatus;
}

export type ManagedAgentMutationOperation =
  | 'create'
  | 'update-config'
  | 'import-config'
  | 'disable'
  | 'reactivate'
  | 'rename';

export type ManagedAgentProjectionOutcome =
  | AgentConfigProjectionStatus
  | Readonly<{
      kind: 'failed';
      failure: Readonly<{ code: 'MANAGED_AGENT_PROJECTION_FAILED' }>;
    }>;

/**
 * An authority mutation completed. Projection coordination is reported separately because it is
 * recoverable secondary state and cannot roll back the authoritative commit.
 */
export interface ManagedAgentCommitResult<TConfig> {
  readonly status: 'committed';
  readonly operation: ManagedAgentMutationOperation;
  readonly authority: ManagedAgentAuthoritySnapshot<TConfig>;
  readonly projection: ManagedAgentProjectionOutcome;
}

export interface AgentManagementService<TConfig> {
  create(
    request: CreateManagedAgentRequest<TConfig>,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<TConfig>>;
  inspect(
    agentId: AgentId,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentSnapshot<TConfig>>;
  list(options?: ManagementOperationOptions): Promise<readonly ManagedAgentSnapshot<TConfig>[]>;
  updateConfig(
    request: UpdateManagedAgentConfigRequest<TConfig>,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<TConfig>>;
  importConfig(
    request: ImportManagedAgentConfigRequest,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<TConfig>>;
  disable(
    request: TransitionManagedAgentRequest,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<TConfig>>;
  reactivate(
    request: TransitionManagedAgentRequest,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<TConfig>>;
  rename(
    request: RenameManagedAgentRequest,
    options?: ManagementOperationOptions
  ): Promise<ManagedAgentCommitResult<TConfig>>;
}
