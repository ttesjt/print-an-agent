import {
  type RetrievalMemoryManagementCapability,
  type RetrievalMemoryManagementContext,
  type RetrievalMemoryManagementService,
  createRetrievalMemoryOperations,
  MemoryManagementError,
  RETRIEVAL_MEMORY_MANAGEMENT_OPERATIONS,
} from '../memory/index.js';
import type { ManagedAgentNamespacePort } from '../namespace/index.js';

export function createRetrievalMemoryManagementService<N>(
  definition: {
    readonly namespace: { readonly port: ManagedAgentNamespacePort<N> };
  } & RetrievalMemoryManagementCapability<N>
): RetrievalMemoryManagementService;
export function createRetrievalMemoryManagementService<N, const D extends object>(
  definition: RetrievalMemoryManagementContext<N> &
    D &
    Readonly<Record<Exclude<'retrievalMemoryManagement', keyof D>, never>>
): RetrievalMemoryManagementService;
export function createRetrievalMemoryManagementService<N>(
  definition: RetrievalMemoryManagementContext<N>
): RetrievalMemoryManagementService {
  const capability = definition.retrievalMemoryManagement;
  if (
    capability === undefined ||
    capability === null ||
    capability.resolve === undefined ||
    capability.resolve === null ||
    typeof capability.resolve !== 'object' ||
    RETRIEVAL_MEMORY_MANAGEMENT_OPERATIONS.some(
      (key) => typeof Reflect.get(capability.resolve, key) !== 'function'
    )
  )
    throw new MemoryManagementError('MEMORY_CAPABILITY_UNAVAILABLE', undefined);
  const factories = capability.resolve;
  return createRetrievalMemoryOperations(definition, factories);
}
