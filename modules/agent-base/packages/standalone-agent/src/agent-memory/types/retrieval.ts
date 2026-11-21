import type { ResourceAcquisition } from '@print-an-agent/base-composition/resource-registry';
import type { TextEmbeddingCapability } from '@print-an-agent/model-invocation-core';
import type {
  RetrievalBackend,
  RetrievalChunker,
  RetrievalPolicy,
  RetrievalWorkflowDefinitions,
} from '@print-an-agent/retrieval-memory';
import type {
  MemoryCapabilityAcquirer,
  MemoryStorageAcquisition,
  MemoryTextCounter,
} from './acquisition.js';

export interface StandaloneRetrievalMemoryOptions {
  readonly acquireEmbedding?: MemoryCapabilityAcquirer<TextEmbeddingCapability>;
  readonly acquireChunker?: MemoryCapabilityAcquirer<RetrievalChunker>;
  readonly acquireCounter?: MemoryCapabilityAcquirer<MemoryTextCounter>;
  readonly measurementRef?: string;
  readonly acquireBackend?: (
    input: MemoryStorageAcquisition
  ) => ResourceAcquisition<RetrievalBackend> | Promise<ResourceAcquisition<RetrievalBackend>>;
  readonly policy?: Partial<RetrievalPolicy>;
  readonly workflows?: Partial<RetrievalWorkflowDefinitions>;
}
