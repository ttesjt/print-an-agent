import type {
  ImportManagedAgentConfigRequest,
  ManagedAgentCommitResult,
  ManagedAgentSnapshot,
  ManagementOperationOptions,
} from '@print-an-agent/base-composition';
import type { AgentIdentityInput } from '@print-an-agent/base-identity-config/identity';
import type {
  StandaloneAgentConfig,
  StandaloneAgentConfigInput,
} from '../../configuration/index.js';

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
