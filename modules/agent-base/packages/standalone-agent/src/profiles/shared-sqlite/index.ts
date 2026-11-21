export { createSharedSqliteStandaloneDefinition } from './create-definition.js';

export { createSharedSqliteStandaloneSetup } from './create-setup.js';

export {
  createSharedSqliteStandaloneManagementService,
  createSharedSqliteStandaloneRuntimeService,
  createSharedSqliteStandaloneSessionNavigationService,
  createSharedSqliteStandaloneSessionService,
} from './services.js';

export type { SharedSqliteStandaloneDefinition } from './types/definition.js';

export type {
  CreateSharedSqliteStandaloneManagementServiceOptions,
  CreateSharedSqliteStandaloneNavigationServiceOptions,
  CreateSharedSqliteStandaloneProfileOptions,
  CreateSharedSqliteStandaloneSessionServiceOptions,
} from './types/options.js';

export type { SharedSqliteAgentResourceNamespace } from './types/namespace.js';

export type {
  ResolvedStandaloneSharedSqliteTableNames,
  StandaloneSharedSqliteTableNamesInput,
  StandaloneSharedSqliteTableNamingInput,
} from './types/table-naming.js';

export type {
  SqliteManagedNamespaceTableNames,
  SqliteManagedNamespaceTableNamesInput,
  SqliteManagedNamespaceTableNamingInput,
} from './types/namespace-tables.js';

export { SQLITE_MANAGED_NAMESPACE_TABLE_KEYS } from './resources/table-keys.js';

export type { SqliteManagedNamespaceTableName } from './resources/table-keys.js';

export {
  DEFAULT_SQLITE_MANAGED_NAMESPACE_TABLE_NAMES,
  quoteSqliteIdentifier,
  resolveSqliteManagedNamespaceTableNames,
} from './resources/table-names.js';
