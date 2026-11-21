export { createStandaloneMemorySetup } from './memory/index.js';

export type {
  CreateStandaloneMemoryProfileOptions,
  MemoryAgentResourceNamespace,
  MemoryAuthorityFactory,
  MemorySessionPersistenceFactory,
  StandaloneMemoryDefinition,
  StandaloneMemorySetup,
} from './memory/index.js';

export {
  createStandaloneDirectoryDefinition,
  createStandaloneDirectoryManagementService,
  createStandaloneDirectoryRuntimeService,
  createStandaloneDirectorySessionNavigationService,
  createStandaloneDirectorySessionService,
  createStandaloneDirectorySetup,
} from './directory/index.js';

export type {
  CreateStandaloneDirectoryManagementServiceOptions,
  CreateStandaloneDirectoryNavigationServiceOptions,
  CreateStandaloneDirectoryProfileOptions,
  CreateStandaloneDirectorySessionServiceOptions,
  FilesystemAgentResourceNamespace,
  StandaloneDirectoryDefinition,
} from './directory/index.js';

export {
  DEFAULT_SQLITE_MANAGED_NAMESPACE_TABLE_NAMES,
  SQLITE_MANAGED_NAMESPACE_TABLE_KEYS,
  createSharedSqliteStandaloneDefinition,
  createSharedSqliteStandaloneManagementService,
  createSharedSqliteStandaloneRuntimeService,
  createSharedSqliteStandaloneSessionNavigationService,
  createSharedSqliteStandaloneSessionService,
  createSharedSqliteStandaloneSetup,
  quoteSqliteIdentifier,
  resolveSqliteManagedNamespaceTableNames,
} from './shared-sqlite/index.js';

export type {
  CreateSharedSqliteStandaloneManagementServiceOptions,
  CreateSharedSqliteStandaloneNavigationServiceOptions,
  CreateSharedSqliteStandaloneProfileOptions,
  CreateSharedSqliteStandaloneSessionServiceOptions,
  ResolvedStandaloneSharedSqliteTableNames,
  SharedSqliteAgentResourceNamespace,
  SharedSqliteStandaloneDefinition,
  SqliteManagedNamespaceTableName,
  SqliteManagedNamespaceTableNames,
  SqliteManagedNamespaceTableNamesInput,
  SqliteManagedNamespaceTableNamingInput,
  StandaloneSharedSqliteTableNamesInput,
  StandaloneSharedSqliteTableNamingInput,
} from './shared-sqlite/index.js';
