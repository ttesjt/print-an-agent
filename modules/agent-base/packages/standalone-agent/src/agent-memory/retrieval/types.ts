import type {
  MemoryManagementOptions,
  MemoryProvisioningRequest,
} from '@print-an-agent/base-composition';
import type {
  createRetrievalContentBundle,
  createRetrievalMemoryBundle,
  RetrievalBackend,
  RetrievalResources,
  SpaceInput,
} from '@print-an-agent/retrieval-memory';
import type { MemoryProfileAllocation } from '../types/allocation.js';

export interface RetrievalMemoryState<I> extends MemoryProfileAllocation {
  readonly memoryId: string;
  readonly backend: RetrievalBackend;
  readonly input: I & { readonly memoryId: string };
  readonly bundle: ReturnType<typeof createRetrievalContentBundle>;
}

export interface IndexedRetrievalMemory<I> extends RetrievalMemoryState<I> {
  readonly index: { readonly embeddingRef: string; readonly chunkerRef: string };
  readonly embeddings: RetrievalResources['embeddings'];
}

export type WritableRetrievalMemory<I> = Omit<IndexedRetrievalMemory<I>, 'bundle'> & {
  readonly bundle: ReturnType<typeof createRetrievalMemoryBundle>;
};

export interface RetrievalMemoryResourceResolvers<N> {
  state<I extends SpaceInput>(
    this: void,
    request: MemoryProvisioningRequest<N, I>,
    call?: MemoryManagementOptions
  ): Promise<RetrievalMemoryState<I>>;
  models<I extends SpaceInput>(
    this: void,
    request: MemoryProvisioningRequest<N, I>,
    call?: MemoryManagementOptions
  ): Promise<IndexedRetrievalMemory<I>>;
  writable<I extends SpaceInput>(
    this: void,
    request: MemoryProvisioningRequest<N, I>,
    call?: MemoryManagementOptions
  ): Promise<WritableRetrievalMemory<I>>;
}
