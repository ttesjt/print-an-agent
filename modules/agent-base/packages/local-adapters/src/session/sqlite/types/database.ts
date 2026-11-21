export interface SqliteDatabaseConfiguration {
  readonly databasePath: string;
  readonly busyTimeoutMilliseconds: number;
}
