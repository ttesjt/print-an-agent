import type {
  ResolvedStandaloneManagedSqliteTableNames,
  StandaloneManagedSqliteTableNamesInput,
} from '../../../sqlite/index.js';
import type {
  SqliteManagedNamespaceTableNames,
  SqliteManagedNamespaceTableNamesInput,
} from './namespace-tables.js';

export interface StandaloneSharedSqliteTableNamesInput extends StandaloneManagedSqliteTableNamesInput {
  readonly managedNamespace?: SqliteManagedNamespaceTableNamesInput;
}

export interface StandaloneSharedSqliteTableNamingInput {
  readonly tablePrefix?: string;
  readonly tableNames?: StandaloneSharedSqliteTableNamesInput;
}

export interface ResolvedStandaloneSharedSqliteTableNames extends ResolvedStandaloneManagedSqliteTableNames {
  readonly managedNamespace: SqliteManagedNamespaceTableNames;
}
