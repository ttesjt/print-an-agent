import type { EntryPage, StoredEntry } from '../../types/entry.js';
import type { MetadataFilter } from '../../filters/index.js';
import type { RetrievalSpace } from '../../types/space.js';
import type { SearchResult } from '../../types/search.js';
import type { RetrievalPublication, RetrievalReceipt } from '../../types/publication.js';

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
