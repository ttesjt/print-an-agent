import type { StandaloneRuntimeOptions } from '../../../runtime/index.js';
import type { StandaloneManagedSqliteTableNamingInput } from '../../../sqlite/index.js';

export interface CreateStandaloneDirectoryProfileOptions extends StandaloneRuntimeOptions {
  readonly rootDirectory: string;
  readonly clock?: () => number;
  readonly createTemporaryId?: () => string;
  readonly sqlite?: StandaloneManagedSqliteTableNamingInput;
}

export type CreateStandaloneDirectoryManagementServiceOptions = Omit<
  CreateStandaloneDirectoryProfileOptions,
  keyof StandaloneRuntimeOptions
>;

export type CreateStandaloneDirectorySessionServiceOptions =
  CreateStandaloneDirectoryManagementServiceOptions;

export type CreateStandaloneDirectoryNavigationServiceOptions =
  CreateStandaloneDirectoryManagementServiceOptions;
