import type {
  CollectionChoice,
  CollectionReference,
  RecentCollection,
  RecentCollectionsPersistencePort,
} from '@ta-agent/ui-contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const RECENT_COLLECTION_LIMIT = 12;
interface HistoryState<Reference extends CollectionReference> {
  current: readonly RecentCollection<Reference>[];
  persisted: readonly RecentCollection<Reference>[];
  revision: number;
  queue: Promise<void>;
  active: boolean;
  writeFailed: boolean;
}

export function useRecentCollections<Reference extends CollectionReference>(
  persistence: RecentCollectionsPersistencePort<Reference>
) {
  const [records, setRecords] = useState<readonly RecentCollection<Reference>[]>([]);
  const [warning, setWarning] = useState<string>();
  const state = useMemo<HistoryState<Reference>>(
    () => ({
      current: [],
      persisted: [],
      revision: 0,
      queue: Promise.resolve(),
      active: false,
      writeFailed: false,
    }),
    [persistence]
  );
  const enqueue = useCallback(
    (operation: () => Promise<void>) => {
      state.queue = state.queue.then(operation).catch(() => {
        if (state.active)
          setWarning('Recent Collection history is unavailable. Opening a Collection still works.');
      });
      return state.queue;
    },
    [state]
  );
  const read = useCallback(() => {
    const revision = state.revision;
    return enqueue(async () => {
      // Failed writes leave a newer in-tab snapshot. Do not replace it with known stale storage.
      // A subsequent successful save re-enables authoritative history reloads.
      if (state.writeFailed) return;
      try {
        state.persisted = boundedHistory(await persistence.loadRecentCollections());
        // A later local edit owns the visible optimistic list until its queued merge finishes.
        if (!state.active || revision !== state.revision) return;
        state.current = state.persisted;
        setRecords(state.current);
        setWarning(undefined);
      } catch {
        if (state.active)
          setWarning('Recent Collection history is unavailable. Opening a Collection still works.');
      }
    });
  }, [enqueue, persistence, state]);
  useEffect(() => {
    state.active = true;
    setRecords(state.current);
    setWarning(undefined);
    void read();
    const unsubscribe = persistence.subscribe?.(() => {
      void read();
    });
    return () => {
      state.active = false;
      unsubscribe?.();
    };
  }, [persistence, read, state]);
  const update = useCallback(
    (
      transform: (
        records: readonly RecentCollection<Reference>[]
      ) => readonly RecentCollection<Reference>[]
    ) => {
      if (!state.active) return;
      const revision = ++state.revision;
      state.current = boundedHistory(transform(state.current));
      setRecords(state.current);
      // Initial loads, external reloads and mutations share one per-port queue. Replay the
      // edit over the loaded baseline, rather than persisting an initially empty optimistic list.
      void enqueue(async () => {
        state.persisted = boundedHistory(transform(state.persisted));
        if (state.active && revision === state.revision) {
          state.current = state.persisted;
          setRecords(state.current);
        }
        try {
          await persistence.saveRecentCollections(state.persisted);
          state.writeFailed = false;
          if (state.active) setWarning(undefined);
        } catch {
          state.writeFailed = true;
          if (state.active)
            setWarning('Recent history could not be saved. It remains available in this tab.');
        }
      });
    },
    [enqueue, persistence, state]
  );
  const remember = useCallback(
    (collection: CollectionChoice<Reference>) => {
      const lastUsedAt = new Date().toISOString();
      update((existing) => [
        { collection, lastUsedAt },
        ...existing.filter((record) => record.collection.key !== collection.key),
      ]);
    },
    [update]
  );
  return {
    records,
    warning,
    remember,
    forget: (key: string) =>
      update((existing) => existing.filter((record) => record.collection.key !== key)),
    clear: () => update(() => []),
    resolveReference: async (key: string, signal: AbortSignal) => {
      signal.throwIfAborted();
      await read();
      await state.queue;
      signal.throwIfAborted();
      return state.current.find((record) => record.collection.key === key)?.collection.reference;
    },
  };
}

function boundedHistory<Reference extends CollectionReference>(
  records: readonly RecentCollection<Reference>[]
): readonly RecentCollection<Reference>[] {
  const seen = new Set<string>();
  return records
    .filter((record) => {
      if (seen.has(record.collection.key)) return false;
      seen.add(record.collection.key);
      return true;
    })
    .slice(0, RECENT_COLLECTION_LIMIT);
}
