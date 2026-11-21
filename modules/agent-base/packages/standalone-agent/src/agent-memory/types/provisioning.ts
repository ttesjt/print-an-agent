import type {
  ResourceBlueprint,
  ResourceToken,
} from '@print-an-agent/base-composition/resource-registry';
import type { MemoryStore } from '@print-an-agent/context-memory';
import type { TextEmbeddingCapability } from '@print-an-agent/model-invocation-core';
import type { RetrievalBackend, RetrievalChunker } from '@print-an-agent/retrieval-memory';
import type { MemoryTextCounter } from './acquisition.js';

export interface MemoryManagementRecipe {
  readonly blueprint: ResourceBlueprint;
  readonly store: ResourceToken<string, MemoryStore>;
  readonly backend: ResourceToken<string, RetrievalBackend>;
  readonly counter: ResourceToken<string, MemoryTextCounter>;
  readonly retrievalCounter: ResourceToken<string, MemoryTextCounter>;
  readonly embedding: ResourceToken<string, TextEmbeddingCapability>;
  readonly chunker: ResourceToken<string, RetrievalChunker>;
}
