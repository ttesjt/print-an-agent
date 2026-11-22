import {
  identifier,
  jsonSnapshot,
  RetrievalMemoryError,
  type BackendSearch,
  type EntryPage,
  type RetrievalPublication,
  type RetrievalReceipt,
  type RetrievalSpace,
  type SearchResult,
  type StoredEntry,
} from '@print-an-agent/retrieval-memory';
import { createWorkerClient } from '../client.js';
import { normalizeConfiguration } from './configuration.js';
import type { SqliteRetrievalOptions, OwnedRetrievalBackend } from './types.js';
/** Host-owned connection/worker. Bundles borrow the returned backend and never close it. */
export async function openSqliteRetrievalBackend(
  options: SqliteRetrievalOptions
): Promise<OwnedRetrievalBackend> {
  const client = await createWorkerClient(normalizeConfiguration(options));
  return {
    inspect: async (memoryId, signal) =>
      (await client.call('inspect', [identifier(memoryId)], signal)) as RetrievalSpace | undefined,
    get: async (memoryId, entryId, signal) =>
      (await client.call('get', [identifier(memoryId), identifier(entryId)], signal)) as
        | StoredEntry
        | undefined,
    getReceipt: async (memoryId, requestId, signal) =>
      (await client.call('getReceipt', [identifier(memoryId), identifier(requestId)], signal)) as
        | RetrievalReceipt
        | undefined,
    publish: async (candidate: RetrievalPublication, signal) => {
      let dispatched = false;
      try {
        jsonSnapshot(candidate);
        dispatched = true;
        return (await client.call('publish', [candidate], signal)) as RetrievalReceipt;
      } catch (cause) {
        if (cause instanceof RetrievalMemoryError && cause.commit !== undefined) throw cause;
        const aborted = cause instanceof RetrievalMemoryError && cause.code === 'OPERATION_ABORTED';
        throw new RetrievalMemoryError(
          cause instanceof RetrievalMemoryError ? cause.code : 'STORAGE_FAILED',
          'SQLite publication failed.',
          {
            cause,
            commit:
              !dispatched || aborted
                ? { status: 'not-committed' }
                : {
                    status: 'unknown',
                    memoryId: candidate.mutation.input.memoryId,
                    requestId: candidate.mutation.input.requestId,
                  },
          }
        );
      }
    },
    list: async (input, signal) => {
      jsonSnapshot(input);
      return (await client.call('list', [input], signal)) as EntryPage;
    },
    search: async (input: BackendSearch, signal) => {
      jsonSnapshot(input);
      return (await client.call('search', [input], signal)) as SearchResult;
    },
    close: () => client.close(),
  };
}
