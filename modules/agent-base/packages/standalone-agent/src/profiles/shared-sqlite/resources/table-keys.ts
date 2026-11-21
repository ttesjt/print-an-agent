export const SQLITE_MANAGED_NAMESPACE_TABLE_KEYS = Object.freeze(['schema', 'namespaces'] as const);

export type SqliteManagedNamespaceTableName = (typeof SQLITE_MANAGED_NAMESPACE_TABLE_KEYS)[number];
