import type {
  MemoryAuthorityFactory,
  MemorySessionPersistenceFactory,
} from './resources/memory/contracts.js';
import type {
  StandaloneManagedSqliteTableNamingInput,
  StandaloneSharedSqliteTableNamingInput,
} from './resources/sqlite-table-naming.js';
import type { StandaloneRuntimeOptions } from './runtime/index.js';

export interface CreateStandaloneDirectoryProfileOptions extends StandaloneRuntimeOptions {
  readonly rootDirectory: string;
  readonly clock?: () => number;
  readonly createTemporaryId?: () => string;
  readonly sqlite?: StandaloneManagedSqliteTableNamingInput;
}

export interface CreateStandaloneMemoryProfileOptions extends StandaloneRuntimeOptions {
  readonly clock?: () => number;
  /** Allocation authority is prepared before stage returns; never supplied by a business Run. */
  readonly acquireAuthority?: MemoryAuthorityFactory;
  /** Profile recipe, fixed at setup construction. Each allocation owns its acquisition. */
  readonly acquireSessionPersistence?: MemorySessionPersistenceFactory;
}

export type CreateStandaloneDirectoryManagementServiceOptions = Omit<
  CreateStandaloneDirectoryProfileOptions,
  keyof StandaloneRuntimeOptions
>;

export type CreateStandaloneDirectorySessionServiceOptions =
  CreateStandaloneDirectoryManagementServiceOptions;

export type CreateStandaloneDirectoryNavigationServiceOptions =
  CreateStandaloneDirectoryManagementServiceOptions;

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
