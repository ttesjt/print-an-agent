import type { CollectionChoice, CollectionReference } from './collection.js';

/** Convenience history, never authoritative storage, credentials or a live connection. */
export interface RecentCollection<Reference extends CollectionReference = CollectionReference> {
  readonly collection: CollectionChoice<Reference>;
  readonly lastUsedAt: string;
}

/** Replaceable persistence. Application owns retention, deduplication and failure recovery. */
export interface RecentCollectionsPersistencePort<
  Reference extends CollectionReference = CollectionReference,
> {
  loadRecentCollections(): Promise<readonly RecentCollection<Reference>[]>;
  saveRecentCollections(records: readonly RecentCollection<Reference>[]): Promise<void>;
  /** A notification means re-read history; it never means change the active Collection. */
  subscribe?: (listener: () => void) => () => void;
}
