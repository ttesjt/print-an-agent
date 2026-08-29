import type {
  BaseId,
  ModelBase,
  ModelModification,
  ModelOutput,
  ModelRun,
  ModificationId,
  OutputId,
  RunId,
} from '@ta-agent/workbench-domain';

export interface PersistenceRecordCollection<TIdentity, TRecord> {
  find(identity: TIdentity): TRecord | undefined;
  list(request: Readonly<{ after?: TIdentity; limit: number }>): Readonly<{
    records: readonly TRecord[];
    hasMore: boolean;
  }>;
  store(identity: TIdentity, record: TRecord): void;
}

/** Internal storage primitive shared by persistence adapter implementations. */
export interface PersistenceRecordStore {
  readonly runs: PersistenceRecordCollection<RunId, ModelRun>;
  readonly bases: PersistenceRecordCollection<BaseId, ModelBase>;
  readonly modifications: PersistenceRecordCollection<ModificationId, ModelModification>;
  readonly outputs: PersistenceRecordCollection<OutputId, ModelOutput>;
  transaction<TResult>(operation: () => TResult): TResult;
}
