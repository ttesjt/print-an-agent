import {
  type ContextMemoryManagementCapability,
  type ContextMemoryManagementContext,
  type ContextMemoryManagementService,
  CONTEXT_MEMORY_MANAGEMENT_OPERATIONS,
  createContextMemoryOperations,
  MemoryManagementError,
} from '../memory/index.js';
import type { ManagedAgentNamespacePort } from '../namespace/index.js';

/** Known absent capabilities are a type error. Optional Profile capabilities are checked at creation. */
export function createContextMemoryManagementService<N>(
  definition: {
    readonly namespace: { readonly port: ManagedAgentNamespacePort<N> };
  } & ContextMemoryManagementCapability<N>
): ContextMemoryManagementService;
export function createContextMemoryManagementService<N, const D extends object>(
  definition: ContextMemoryManagementContext<N> &
    D &
    Readonly<Record<Exclude<'contextMemoryManagement', keyof D>, never>>
): ContextMemoryManagementService;
export function createContextMemoryManagementService<N>(
  definition: ContextMemoryManagementContext<N>
): ContextMemoryManagementService {
  const capability = definition.contextMemoryManagement;
  if (
    capability === undefined ||
    capability === null ||
    typeof capability.resolve !== 'object' ||
    capability.resolve === null ||
    CONTEXT_MEMORY_MANAGEMENT_OPERATIONS.some(
      (key) => typeof Reflect.get(capability.resolve, key) !== 'function'
    )
  )
    throw new MemoryManagementError('MEMORY_CAPABILITY_UNAVAILABLE', undefined);
  const factories = capability.resolve;
  return createContextMemoryOperations(definition, factories);
}
