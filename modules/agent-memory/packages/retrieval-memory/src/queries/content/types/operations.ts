import type { RetrievalEntry, EntryPage } from '../../../types/entry.js';
import type { RetrievalSpace } from '../../../types/space.js';
import type { RetrievalReceipt } from '../../../types/publication.js';

export interface RetrievalContentQueryOperations {
  inspect(input: unknown, signal: AbortSignal): Promise<RetrievalSpace>;
  get(input: unknown, signal: AbortSignal): Promise<RetrievalEntry>;
  getReceipt(input: unknown, signal: AbortSignal): Promise<RetrievalReceipt | undefined>;
  list(input: unknown, signal: AbortSignal): Promise<EntryPage>;
}
