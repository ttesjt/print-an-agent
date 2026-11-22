import {
  identifier,
  jsonSnapshot,
  RetrievalMemoryError,
  type BackendSearch,
  type RetrievalPublication,
} from '@print-an-agent/retrieval-memory';
import { createWorkerClient } from '../worker/index.js';
import { normalizeConfiguration } from './configuration.js';
import type { SqliteRetrievalOptions, OwnedRetrievalBackend } from './types.js';
/** Host-owned connection/worker. Bundles borrow the returned backend and never close it. */
export async function openSqliteRetrievalBackend(
  options: SqliteRetrievalOptions
): Promise<OwnedRetrievalBackend> {
  const client = await createWorkerClient(normalizeConfiguration(options));
  return {
    inspect: async (memoryId, signal) => client.call('inspect', [identifier(memoryId)], signal),
    get: async (memoryId, entryId, signal) =>
      client.call('get', [identifier(memoryId), identifier(entryId)], signal),
    getReceipt: async (memoryId, requestId, signal) =>
      client.call('getReceipt', [identifier(memoryId), identifier(requestId)], signal),
    publish: async (candidate: RetrievalPublication, signal) => {
      let dispatched = false;
      try {
        jsonSnapshot(candidate);
        dispatched = true;
        return await client.call('publish', [candidate], signal);
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
      return client.call('list', [input], signal);
    },
    search: async (input: BackendSearch, signal) => {
      jsonSnapshot(input);
      return client.call('search', [input], signal);
    },
    close: () => client.close(),
  };
}
