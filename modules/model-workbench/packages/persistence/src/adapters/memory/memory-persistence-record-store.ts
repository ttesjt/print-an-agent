import type {
  BaseId,
  ModelBase,
  ModelModification,
  ModelOutput,
  ModelRun,
  ModificationId,
  OutputId,
  RunId,
} from '@print-an-agent/workbench-domain';

import type {
  PersistenceRecordCollection,
  PersistenceRecordStore,
} from '../../record-store/persistence-record-store.js';

export function createMemoryPersistenceRecordStore(): PersistenceRecordStore {
  return {
    runs: createMemoryCollection<RunId, ModelRun>(),
    bases: createMemoryCollection<BaseId, ModelBase>(),
    modifications: createMemoryCollection<ModificationId, ModelModification>(),
    outputs: createMemoryCollection<OutputId, ModelOutput>(),
    transaction: <TResult>(operation: () => TResult): TResult => operation(),
  };
}

function createMemoryCollection<TIdentity, TRecord>(): PersistenceRecordCollection<
  TIdentity,
  TRecord
> {
  const records = new Map<TIdentity, TRecord>();
  return {
    find: (identity) => records.get(identity),
    list: ({ after, limit }) => {
      const ordered = [...records.entries()].sort(([left], [right]) =>
        compareIdentity(left, right)
      );
      const remaining =
        after === undefined
          ? ordered
          : ordered.filter(([identity]) => compareIdentity(identity, after) > 0);
      return Object.freeze({
        records: Object.freeze(remaining.slice(0, limit).map(([, record]) => record)),
        hasMore: remaining.length > limit,
      });
    },
    store: (identity, record) => records.set(identity, record),
  };
}

function compareIdentity<TIdentity>(left: TIdentity, right: TIdentity): number {
  const leftValue = String(left);
  const rightValue = String(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
