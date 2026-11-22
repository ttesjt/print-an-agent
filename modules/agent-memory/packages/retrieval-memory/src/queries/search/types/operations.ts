import type { SearchResult } from '../../../types/search.js';

export interface RetrievalSearchOperations {
  search(input: unknown, signal: AbortSignal): Promise<SearchResult>;
}
