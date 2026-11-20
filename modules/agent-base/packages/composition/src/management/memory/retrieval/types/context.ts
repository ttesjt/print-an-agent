import type { ManagedAgentNamespacePort } from '../../../namespace/index.js';
import type { RetrievalMemoryManagementCapability } from './operations.js';

export type RetrievalMemoryManagementContext<N> = {
  readonly namespace: { readonly port: ManagedAgentNamespacePort<N> };
} & Partial<RetrievalMemoryManagementCapability<N>>;
