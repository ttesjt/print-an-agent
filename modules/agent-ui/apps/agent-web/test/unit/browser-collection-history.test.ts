import { afterEach, expect, it } from 'vitest';
import {
  createBrowserCollectionHistory,
  RECENT_COLLECTION_STORAGE_KEY,
} from '../../src/adapters/browser-collection-history.js';

afterEach(() => window.localStorage.clear());
const record = {
  collection: {
    key: 'canonical',
    label: 'Research',
    reference: { rootDirectory: '/example/research' },
  },
  lastUsedAt: '2026-01-01T00:00:00.000Z',
};
it('round-trips only safe references, never connections or arbitrary configuration', async () => {
  const port = createBrowserCollectionHistory();
  await port.saveRecentCollections([record]);
  expect(await port.loadRecentCollections()).toEqual([record]);
  const unsafe = {
    ...record,
    collection: {
      ...record.collection,
      reference: { ...record.collection.reference, apiKey: 'secret' },
    },
  };
  expect(() => port.saveRecentCollections([unsafe])).toThrow();
  expect(window.localStorage.getItem(RECENT_COLLECTION_STORAGE_KEY)).not.toContain('secret');
});
it.each(['{broken', 'null', '{}', '[{"collection":{"key":"a"},"lastUsedAt":"bad"}]'])(
  'ignores corrupt persisted data: %s',
  async (raw) => {
    window.localStorage.setItem(RECENT_COLLECTION_STORAGE_KEY, raw);
    expect(await createBrowserCollectionHistory().loadRecentCollections()).toEqual([]);
  }
);

it('notifies about history only and releases cross-tab listeners', async () => {
  const port = createBrowserCollectionHistory();
  let updates = 0;
  const stop = port.subscribe?.(() => updates++);
  const hash = window.location.hash;
  await port.saveRecentCollections([record]);
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: RECENT_COLLECTION_STORAGE_KEY,
      storageArea: window.localStorage,
    })
  );
  expect(updates).toBe(1);
  expect(window.location.hash).toBe(hash);
  stop?.();
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: RECENT_COLLECTION_STORAGE_KEY,
      storageArea: window.localStorage,
    })
  );
  expect(updates).toBe(1);
});
