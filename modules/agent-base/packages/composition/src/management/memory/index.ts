export {
  CONTEXT_MEMORY_MANAGEMENT_OPERATIONS,
  createContextMemoryOperations,
  type ContextMemoryManagementCapability,
  type ContextMemoryManagementContext,
  type ContextMemoryManagementInputs,
  type ContextMemoryManagementOutputs,
  type ContextMemoryManagementService,
  type ContextMemoryReplayInput,
} from './context/index.js';
export {
  MemoryManagementError,
  type ManagedMemoryFailure,
  type MemoryManagementErrorCode,
} from './errors.js';
export { scopedAgentMemoryId, validateMemoryIdentifier } from './identity.js';

export {
  RETRIEVAL_MEMORY_MANAGEMENT_OPERATIONS,
  createRetrievalMemoryOperations,
  type RetrievalMemoryManagementCapability,
  type RetrievalMemoryManagementContext,
  type RetrievalMemoryManagementInputs,
  type RetrievalMemoryManagementOutputs,
  type RetrievalMemoryManagementService,
} from './retrieval/index.js';
export {
  type MemoryInvocation,
  type MemoryManagementOptions,
  type MemoryOperationProvisioning,
  type MemoryProvisioningRequest,
} from './types/provisioning.js';
export { type AgentMemoryReference, type ManagedMemoryResult } from './types/reference.js';
