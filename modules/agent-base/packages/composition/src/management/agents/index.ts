export { importManagedAgentConfig, updateManagedAgentConfig } from './config-mutations.js';
export { createManagedAgent } from './create.js';
export { renameManagedAgent, transitionManagedAgent } from './identity-mutations.js';

export { inspectManagedAgent, listManagedAgents } from './query.js';
export { type AgentManagementContext } from './types/context.js';
export {
  type AgentManagementService,
  type CreateManagedAgentRequest,
  type ImportManagedAgentConfigRequest,
  type ManagedAgentCommitResult,
  type ManagedAgentMutationOperation,
  type ManagedAgentProjectionOutcome,
  type ManagedAgentSnapshot,
  type RenameManagedAgentRequest,
  type TransitionManagedAgentRequest,
  type UpdateManagedAgentConfigRequest,
} from './types/management.js';
export {
  type AgentConfigProjectionPort,
  type AgentConfigProjectionStatus,
  type AgentConfigProjectionView,
  type ConfiguredAgentConfigProjectionStatus,
} from './types/projection.js';
