import { createManagedStandaloneAgentRegistry } from '../../managed-agent/lifecycle.js';
import type {
  CreateSharedSqliteStandaloneAgentRegistryOptions,
  ManagedStandaloneAgentRegistry,
} from '../../types.js';
import { createSharedSqliteAgentResourceNamespaceAdapter } from './namespace-adapter.js';
import { createSharedSqliteManagedAgentPortFactory } from './port-factory.js';
import { resolveStandaloneSharedSqliteTableNames } from '../sqlite-table-naming.js';

export function createSharedSqliteStandaloneAgentRegistry(
  options: CreateSharedSqliteStandaloneAgentRegistryOptions
): ManagedStandaloneAgentRegistry {
  const tableNames = resolveStandaloneSharedSqliteTableNames(options.sqlite);
  return createManagedStandaloneAgentRegistry({
    namespaces: createSharedSqliteAgentResourceNamespaceAdapter({
      databasePath: options.databasePath,
      ...(options.busyTimeoutMilliseconds === undefined
        ? {}
        : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
      tableNames: tableNames.managedNamespace,
    }),
    ports: createSharedSqliteManagedAgentPortFactory({
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.busyTimeoutMilliseconds === undefined
        ? {}
        : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
      tableNames,
    }),
    readEnvironmentVariable: options.readEnvironmentVariable,
    ...(options.stepOverrides === undefined ? {} : { stepOverrides: options.stepOverrides }),
  });
}
