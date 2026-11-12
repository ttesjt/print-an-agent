import { defineResourceProvider } from '@print-an-agent/base-composition/resource-registry';
import { ContextMemoryError, type MemoryStore } from '@print-an-agent/context-memory';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';
import { RetrievalMemoryError, type RetrievalBackend } from '@print-an-agent/retrieval-memory';
import { openSqliteRetrievalBackend } from '@print-an-agent/retrieval-memory-sqlite';
import type { MemoryRecipe } from '../examples/memory-composition.js';
import { describeResource } from '../examples/tokens.js';

/** Lose delivery only after real SQLite has committed. No fake in-memory authority. */
export function contextStoreProvider(
  recipe: MemoryRecipe,
  options: {
    dropEditReply?: boolean;
    afterClose?: () => void;
  } = {}
) {
  let commits = 0;
  let releases = 0;
  let drop = options.dropEditReply ?? false;
  const provider = defineResourceProvider({
    token: recipe.tokens.contextStore,
    dependencies: {},
    describe: describeResource,
    externalBinding: 'borrowed',
    create: ({ binding }) => {
      const store = new SqliteMemoryStore({ path: binding });
      const value: MemoryStore = {
        read: (id, signal) => store.read(id, signal),
        getReceipt: (id, requestId, signal) => store.getReceipt(id, requestId, signal),
        commit: async (candidate, signal) => {
          const receipt = await store.commit(candidate, signal);
          commits++;
          if (drop && candidate.request.operation === 'edit') {
            drop = false;
            throw new ContextMemoryError(
              'COMMIT_STATUS_UNKNOWN',
              'Injected lost commit delivery.',
              {
                commit: {
                  status: 'unknown',
                  memoryId: receipt.memoryId,
                  requestId: receipt.requestId,
                },
              }
            );
          }
          return receipt;
        },
      };
      return {
        value,
        release: () => {
          releases++;
          store.close(); // Deliberately fail AFTER real release in synthetic close-failure tests.
          options.afterClose?.();
        },
      };
    },
  });
  return {
    provider,
    get commits() {
      return commits;
    },
    get releases() {
      return releases;
    },
  };
}

export function retrievalBackendProvider(recipe: MemoryRecipe) {
  let drop = true;
  let publications = 0;
  const provider = defineResourceProvider({
    token: recipe.tokens.retrievalBackend,
    dependencies: {},
    describe: describeResource,
    create: async ({ binding }) => {
      const backend = await openSqliteRetrievalBackend({ path: binding });
      const value: RetrievalBackend = {
        inspect: (id, signal) => backend.inspect(id, signal),
        get: (id, entry, signal) => backend.get(id, entry, signal),
        getReceipt: (id, requestId, signal) => backend.getReceipt(id, requestId, signal),
        list: (input, signal) => backend.list(input, signal),
        search: (input, signal) => backend.search(input, signal),
        publish: async (candidate, signal) => {
          const receipt = await backend.publish(candidate, signal);
          publications++;
          if (drop && candidate.mutation.operation === 'ingest') {
            drop = false;
            throw new RetrievalMemoryError(
              'COMMIT_UNKNOWN',
              'Injected lost publication delivery.',
              {
                commit: {
                  status: 'unknown',
                  memoryId: receipt.memoryId,
                  requestId: receipt.requestId,
                },
              }
            );
          }
          return receipt;
        },
      };
      return { value, release: () => backend.close() };
    },
  });
  return {
    provider,
    get publications() {
      return publications;
    },
  };
}
