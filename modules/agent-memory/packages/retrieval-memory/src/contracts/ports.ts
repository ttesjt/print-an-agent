import type { TextEmbeddingCapability } from '@print-an-agent/model-invocation-core';
import type {
  ChunkContent,
  EntryPage,
  MetadataFilter,
  RetrievalSpace,
  SearchResult,
  StoredEntry,
} from './data.js';
import type { RetrievalPublication, RetrievalReceipt } from './publication.js';
export interface BackendSearch {
  readonly space: RetrievalSpace;
  readonly vector: readonly number[];
  readonly topK: number;
  readonly filter?: MetadataFilter;
}
/** One coherent authority/index/receipt binding, not independently replaceable partial stores. */
export interface RetrievalBackend {
  inspect(memoryId: string, signal?: AbortSignal): Promise<RetrievalSpace | undefined>;
  get(memoryId: string, entryId: string, signal?: AbortSignal): Promise<StoredEntry | undefined>;
  getReceipt(
    memoryId: string,
    requestId: string,
    signal?: AbortSignal
  ): Promise<RetrievalReceipt | undefined>;
  publish(candidate: RetrievalPublication, signal?: AbortSignal): Promise<RetrievalReceipt>;
  list(
    input: { readonly memoryId: string; readonly limit: number; readonly cursor?: string },
    signal?: AbortSignal
  ): Promise<EntryPage>;
  search(input: BackendSearch, signal?: AbortSignal): Promise<SearchResult>;
}
export interface RetrievalChunker {
  readonly ref: string;
  chunk(content: string, signal: AbortSignal): Promise<readonly ChunkContent[]>;
}
export interface EmbeddingResolver {
  resolve(
    ref: string,
    signal: AbortSignal
  ): TextEmbeddingCapability | Promise<TextEmbeddingCapability>;
}
export interface ChunkerResolver {
  resolve(ref: string, signal: AbortSignal): RetrievalChunker | Promise<RetrievalChunker>;
}
