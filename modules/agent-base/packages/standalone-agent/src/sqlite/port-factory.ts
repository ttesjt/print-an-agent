import type {
  ManagedAgentNamespace,
  ManagedAgentNamespaceReference,
  ManagedAgentRuntimeProvisioningInput,
} from '@print-an-agent/base-composition';
import {
  SqliteAgentConfigAdapter,
  SqliteAgentIdentityCatalogAdapter,
  SqliteSessionAdapter,
  createSqliteSessionPersistence,
} from '@print-an-agent/base-local-adapters';
import type { StandaloneAgentConfig } from '../configuration/index.js';
import type { SqliteDatabaseLocation } from './types/location.js';
import type { StandaloneSqlitePortFactories } from './types/ports.js';
import type { ResolvedStandaloneManagedSqliteTableNames } from './types/table-naming.js';

export function createStandaloneSqlitePortFactories<N extends SqliteDatabaseLocation>(
  options: Readonly<{
    clock?: () => number;
    busyTimeoutMilliseconds?: number;
    tableNames: ResolvedStandaloneManagedSqliteTableNames;
  }>
): StandaloneSqlitePortFactories<N> {
  const createPersistence = (namespace: ManagedAgentNamespace<N>, schemaMode?: 'existing') =>
    createSqliteSessionPersistence({
      databasePath: namespace.handle.databasePath,
      ...(schemaMode === undefined ? {} : { schemaMode }),
      session: { tableNames: options.tableNames.session },
      requestJournal: { tableNames: options.tableNames.requestJournal },
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.busyTimeoutMilliseconds === undefined
        ? {}
        : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
    });

  return Object.freeze({
    createAuthorityPorts: (namespace: ManagedAgentNamespaceReference<N>) =>
      Object.freeze({
        identityCatalog: new SqliteAgentIdentityCatalogAdapter({
          databasePath: namespace.handle.databasePath,
          ...(options.clock === undefined ? {} : { clock: options.clock }),
          ...(options.busyTimeoutMilliseconds === undefined
            ? {}
            : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
          tableNames: options.tableNames.identity,
        }),
        config: new SqliteAgentConfigAdapter({
          databasePath: namespace.handle.databasePath,
          ...(options.busyTimeoutMilliseconds === undefined
            ? {}
            : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
          tableNames: options.tableNames.config,
        }),
      }),
    createRuntimePorts: ({
      namespace,
    }: ManagedAgentRuntimeProvisioningInput<StandaloneAgentConfig, N>) => {
      const { session, requestJournal } = createPersistence(namespace);
      return Object.freeze({ session, requestJournal });
    },
    createSessionManagementPorts: (namespace: ManagedAgentNamespace<N>) => {
      const { session, maintenance } = createPersistence(namespace, 'existing');
      return Object.freeze({ session, maintenance });
    },
    createSessionNavigationPorts: (namespace: ManagedAgentNamespace<N>) =>
      Object.freeze({
        session: new SqliteSessionAdapter({
          databasePath: namespace.handle.databasePath,
          schemaMode: 'existing',
          tableNames: options.tableNames.session,
          ...(options.clock === undefined ? {} : { clock: options.clock }),
          ...(options.busyTimeoutMilliseconds === undefined
            ? {}
            : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
        }),
      }),
  });
}
