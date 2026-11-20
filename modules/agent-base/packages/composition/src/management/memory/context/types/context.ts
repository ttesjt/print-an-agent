import type { ManagedAgentNamespacePort } from '../../../namespace/index.js';
import type { ContextMemoryManagementCapability } from './operations.js';

export type ContextMemoryManagementContext<N> = {
  readonly namespace: { readonly port: ManagedAgentNamespacePort<N> };
} & Partial<ContextMemoryManagementCapability<N>>;
