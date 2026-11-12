import type { RecentCollectionsPersistencePort } from '@print-an-agent/ui-contracts';
import { array, object, text } from '../transport/decoder.js';
import {
  directoryChoice,
  type DirectoryCollectionReference,
} from '../collection/directory-contracts.js';

export const RECENT_COLLECTION_STORAGE_KEY = 'ta-ui-agent-web.recent-collections';
const history = array(object({ collection: directoryChoice, lastUsedAt: text(64, 1) }), 12);

/** Safe directory references only. No arbitrary config/provider payloads enter browser storage. */
export function createBrowserCollectionHistory(
  storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => window.localStorage
): RecentCollectionsPersistencePort<DirectoryCollectionReference> {
  const decode = (input: unknown) => {
    const records = history.decode(input);
    if (records.some((record) => !Number.isFinite(Date.parse(record.lastUsedAt))))
      throw new Error('Invalid history timestamp');
    return records;
  };
  return {
    loadRecentCollections: () => {
      const raw = storage().getItem(RECENT_COLLECTION_STORAGE_KEY);
      if (raw === null) return Promise.resolve([]);
      try {
        return Promise.resolve(raw.length > 100_000 ? [] : decode(JSON.parse(raw) as unknown));
      } catch {
        return Promise.resolve([]);
      }
    },
    saveRecentCollections: (records) => {
      storage().setItem(RECENT_COLLECTION_STORAGE_KEY, JSON.stringify(decode(records)));
      return Promise.resolve();
    },
    subscribe: (listener) => {
      const changed = (event: StorageEvent) => {
        if (event.key !== null && event.key !== RECENT_COLLECTION_STORAGE_KEY) return;
        try {
          if (event.storageArea === storage()) listener();
        } catch {
          listener();
        }
      };
      window.addEventListener('storage', changed);
      return () => window.removeEventListener('storage', changed);
    },
  };
}
