import {
  assertDistinctGroups,
  domainNamingInput,
  normalizeNamingFailure,
  resolveStandaloneManagedSqliteTableNames,
} from '../../../sqlite/index.js';
import type {
  ResolvedStandaloneSharedSqliteTableNames,
  StandaloneSharedSqliteTableNamingInput,
} from '../types/table-naming.js';
import { resolveSqliteManagedNamespaceTableNames } from './table-names.js';

export function resolveStandaloneSharedSqliteTableNames(
  input?: StandaloneSharedSqliteTableNamingInput
): ResolvedStandaloneSharedSqliteTableNames {
  return normalizeNamingFailure(() => {
    const managed = resolveStandaloneManagedSqliteTableNames(input);
    const tableNames = Object.freeze({
      ...managed,
      managedNamespace: resolveSqliteManagedNamespaceTableNames(
        domainNamingInput(input?.tablePrefix, input?.tableNames?.managedNamespace)
      ),
    });
    assertDistinctGroups(Object.values(tableNames));
    return tableNames;
  });
}
