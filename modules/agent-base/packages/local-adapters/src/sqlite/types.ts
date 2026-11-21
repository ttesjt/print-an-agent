export interface SqliteConnectionConfiguration {
  readonly databasePath: string;
  readonly busyTimeoutMilliseconds: number;
}

/** Domain boundaries preserve their own error identities, messages and causes. */
export interface SqliteConnectionFailureMapping {
  operation(cause: unknown): Error;
  close(cause: unknown): Error;
  combine(operation: Error, cleanup: Error): Error;
}

export interface SqliteTransactionOptions {
  readonly begin: 'BEGIN' | 'BEGIN IMMEDIATE';
  readonly existing: 'join' | 'start';
  rollbackFailure(primary: unknown, rollback: unknown): Error;
}
