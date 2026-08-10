import { createManagedStandaloneAgentRegistry } from '../../managed-agent/lifecycle.js';
import type {
  CreateSharedSqliteStandaloneAgentRegistryOptions,
  ManagedStandaloneAgentRegistry,
} from '../../types.js';
import { createSharedSqliteAgentResourceNamespaceAdapter } from './namespace-adapter.js';
import { createSharedSqliteManagedAgentPortFactory } from './port-factory.js';

export function createSharedSqliteStandaloneAgentRegistry(
  options: CreateSharedSqliteStandaloneAgentRegistryOptions
): ManagedStandaloneAgentRegistry {
  return createManagedStandaloneAgentRegistry({
    namespaces: createSharedSqliteAgentResourceNamespaceAdapter({
      databasePath: options.databasePath,
      ...(options.busyTimeoutMilliseconds === undefined
        ? {}
        : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
    }),
    ports: createSharedSqliteManagedAgentPortFactory({
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.busyTimeoutMilliseconds === undefined
        ? {}
        : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
    }),
    readEnvironmentVariable: options.readEnvironmentVariable,
  });
}
