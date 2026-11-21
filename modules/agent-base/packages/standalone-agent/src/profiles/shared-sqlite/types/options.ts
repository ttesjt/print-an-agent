import type { StandaloneRuntimeOptions } from '../../../runtime/index.js';
import type { StandaloneSharedSqliteTableNamingInput } from './table-naming.js';

export interface CreateSharedSqliteStandaloneProfileOptions extends StandaloneRuntimeOptions {
  readonly databasePath: string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
  readonly sqlite?: StandaloneSharedSqliteTableNamingInput;
}

export type CreateSharedSqliteStandaloneManagementServiceOptions = Omit<
  CreateSharedSqliteStandaloneProfileOptions,
  keyof StandaloneRuntimeOptions
>;

export type CreateSharedSqliteStandaloneSessionServiceOptions =
  CreateSharedSqliteStandaloneManagementServiceOptions;

export type CreateSharedSqliteStandaloneNavigationServiceOptions =
  CreateSharedSqliteStandaloneManagementServiceOptions;
