import type { SqliteManagedNamespaceTableName } from '../resources/table-keys.js';

export type SqliteManagedNamespaceTableNamesInput = Readonly<
  Partial<Record<SqliteManagedNamespaceTableName, string>>
>;

export interface SqliteManagedNamespaceTableNamingInput {
  readonly tablePrefix?: string;
  readonly tableNames?: SqliteManagedNamespaceTableNamesInput;
}

export interface SqliteManagedNamespaceTableNames {
  readonly schema: string;
  readonly namespaces: string;
}
