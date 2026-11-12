import type {
  MemoryMutationResources,
  MemoryWorkflowDefinitions,
  MemoryStore,
  VersionedMemoryWorkflowDefinitions,
} from '@print-an-agent/context-memory';
import type {
  RetrievalBackend,
  RetrievalChunker,
  RetrievalPolicy,
  RetrievalWorkflowDefinitions,
} from '@print-an-agent/retrieval-memory';
import type {
  TextEmbeddingCapability,
  TextTokenInput,
  TokenCounter,
} from '@print-an-agent/model-invocation-core';
import type { ResourceAcquisition } from '@print-an-agent/base-composition/resource-registry';
import type {
  ContextMemoryToolScope,
  createContextMemoryTools,
} from '@print-an-agent/base-composition';

export type MemoryTextCounter = TokenCounter<TextTokenInput>;
export type MemoryCapabilityAcquirer<T> = (
  ref: string,
  signal: AbortSignal
) => ResourceAcquisition<T> | Promise<ResourceAcquisition<T>>;
export interface MemoryStorageAcquisition {
  readonly agentId: string;
  readonly path: string;
  readonly signal: AbortSignal;
}
export interface StandaloneContextMemoryOptions {
  /** Explicit runtime installation; management installation alone never enables Agent memory. */
  readonly runtime?: Readonly<{
    readonly enabled?: (agentId: string) => boolean;
    readonly writable?: boolean;
    /** Explicit tool ceiling; custom tool factories must opt in their names here. */
    readonly toolAllowList?: readonly string[];
    readonly createTools?: (
      scope: ContextMemoryToolScope
    ) => ReturnType<typeof createContextMemoryTools>;
    readonly workflows?: Partial<VersionedMemoryWorkflowDefinitions>;
  }>;
  readonly defaults?: MemoryMutationResources['defaults'];
  readonly acquireCounter?: MemoryCapabilityAcquirer<MemoryTextCounter>;
  /** Optional external root. No release means borrowed; a supplied release owns only that acquisition. */
  readonly acquireStore?: (
    input: MemoryStorageAcquisition
  ) => ResourceAcquisition<MemoryStore> | Promise<ResourceAcquisition<MemoryStore>>;
  readonly workflows?: Partial<MemoryWorkflowDefinitions>;
}
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
export interface StandaloneMemoryManagementOptions {
  /** Stable storage tenancy, not a path, Config revision, or host invocation ID. */
  readonly storageNamespaceId: string;
  readonly context?: StandaloneContextMemoryOptions;
  readonly retrieval?: StandaloneRetrievalMemoryOptions;
}
export interface AgentMemoryStorageBinding {
  /** Ephemeral Profiles use their opaque allocation token, durable Profiles a stable namespace key. */
  readonly key: string | symbol;
  readonly contextPath: string;
  readonly retrievalPath: string;
}
