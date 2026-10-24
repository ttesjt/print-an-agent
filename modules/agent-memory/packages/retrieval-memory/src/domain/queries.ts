import type { EntryPage, RetrievalEntry, RetrievalSpace, SearchResult } from '../contracts/data.js';
import type { RetrievalReceipt } from '../contracts/publication.js';
import type { RetrievalResources } from './mutations.js';
import { defineRetrievalPolicy, type RetrievalPolicy } from '../config.js';
import { assertNotAborted, fail } from '../errors.js';
import { requireEntry, requireSpace } from './access.js';
import { parseRetrievalReceipt } from './receipts.js';
import {
  parseEntryInput,
  parseListInput,
  parseReceiptInput,
  parseSearchInput,
  parseSpaceInput,
} from '../validation/queries.js';
import { parseSearchResult } from '../validation/results.js';
import { embedTexts } from '../representation/prepare.js';
import { identifier, record } from '../validation/json.js';
export interface RetrievalQueryOperations {
  inspect(input: unknown, signal: AbortSignal): Promise<RetrievalSpace>;
  get(input: unknown, signal: AbortSignal): Promise<RetrievalEntry>;
  getReceipt(input: unknown, signal: AbortSignal): Promise<RetrievalReceipt | undefined>;
  list(input: unknown, signal: AbortSignal): Promise<EntryPage>;
  search(input: unknown, signal: AbortSignal): Promise<SearchResult>;
}
export function createRetrievalQueries(
  resources: Pick<RetrievalResources, 'backend' | 'embeddings'>,
  options: Partial<RetrievalPolicy> = {}
): RetrievalQueryOperations {
  const policy = defineRetrievalPolicy(options);
  return {
    async inspect(value, signal) {
      const input = parseSpaceInput(value, policy);
      return requireSpace(resources.backend, input.memoryId, signal);
    },
    async get(value, signal) {
      const input = parseEntryInput(value, policy);
      const space = await requireSpace(resources.backend, input.memoryId, signal);
      return (await requireEntry(resources.backend, space, input.entryId, signal)).entry;
    },
    async getReceipt(value, signal) {
      const input = parseReceiptInput(value, policy);
      assertNotAborted(signal);
      const value_ = await resources.backend.getReceipt(input.memoryId, input.requestId, signal);
      if (value_ === undefined) {
        assertNotAborted(signal);
        return undefined;
      }
      const receipt = parseRetrievalReceipt(value_);
      if (receipt.memoryId !== input.memoryId || receipt.requestId !== input.requestId)
        fail('STORAGE_FAILED', 'Receipt scope mismatch.');
      return receipt;
    },
    async list(value, signal) {
      const input = parseListInput(value, policy);
      assertNotAborted(signal);
      const result = await resources.backend.list(input, signal);
      assertNotAborted(signal);
      record(result);
      if (
        result.space.memoryId !== input.memoryId ||
        result.entries.length > input.limit ||
        result.entries.some((entry) => entry.memoryId !== input.memoryId || 'content' in entry)
      )
        fail('STORAGE_FAILED', 'Invalid Entry page.');
      if (result.nextCursor !== null) identifier(result.nextCursor, policy.maxCursorBytes);
      return structuredClone(result);
    },
    async search(value, signal) {
      const input = parseSearchInput(value, policy);
      const space = await requireSpace(resources.backend, input.memoryId, signal);
      const vectors = await embedTexts(
        resources.embeddings,
        space,
        [input.query],
        'query',
        policy,
        signal
      );
      assertNotAborted(signal);
      const result = await resources.backend.search(
        {
          space,
          vector: vectors[0]!,
          topK: input.topK,
          ...(input.filter === undefined ? {} : { filter: input.filter }),
        },
        signal
      );
      assertNotAborted(signal);
      return parseSearchResult(result, space, input.topK);
    },
  };
}
