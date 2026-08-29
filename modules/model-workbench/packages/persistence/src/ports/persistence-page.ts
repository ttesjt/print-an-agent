export interface PersistencePageRequest<TIdentity> {
  readonly after?: TIdentity;
  readonly limit: number;
}

export interface PersistencePage<TRecord> {
  readonly records: readonly TRecord[];
  readonly hasMore: boolean;
}
