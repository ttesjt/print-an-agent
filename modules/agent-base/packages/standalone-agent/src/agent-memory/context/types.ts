import type {
  MemoryManagementOptions,
  MemoryProvisioningRequest,
} from '@print-an-agent/base-composition';
import type {
  ApplyMemoryInput,
  ConfigureMemoryInput,
  createContextMemoryBundle,
  createContextMemoryStateBundle,
  createContextMemoryStateResources,
  CreateMemoryInput,
  MemoryStore,
  ReadContextInput,
} from '@print-an-agent/context-memory';
import type { MemoryProfileAllocation } from '../types/allocation.js';

export interface ContextMemoryState<I> extends MemoryProfileAllocation {
  readonly memoryId: string;
  readonly store: MemoryStore;
  readonly input: I & { readonly memoryId: string };
  readonly resources: ReturnType<typeof createContextMemoryStateResources>;
  readonly bundle: ReturnType<typeof createContextMemoryStateBundle>;
}

export type MeasuredContextMemory<I> = Omit<ContextMemoryState<I>, 'bundle'> & {
  readonly bundle: ReturnType<typeof createContextMemoryBundle>;
};

export interface ContextMemoryResourceResolvers<N> {
  state<I extends { readonly memoryId: string }>(
    this: void,
    request: MemoryProvisioningRequest<N, I>,
    call?: MemoryManagementOptions
  ): Promise<ContextMemoryState<I>>;
  measured<
    I extends CreateMemoryInput | ApplyMemoryInput | ConfigureMemoryInput | ReadContextInput,
  >(
    this: void,
    request: MemoryProvisioningRequest<N, I>,
    operation: 'create' | 'apply' | 'configure' | 'readContext',
    call?: MemoryManagementOptions
  ): Promise<MeasuredContextMemory<I>>;
}
