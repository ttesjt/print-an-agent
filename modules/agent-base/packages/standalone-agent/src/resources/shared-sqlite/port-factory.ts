import {
  SqliteAgentConfigAdapter,
  SqliteAgentIdentityCatalogAdapter,
  SqliteSessionAdapter,
  createSqliteSessionPersistence,
} from '@ta-agent/base-local-adapters';
import type {
  ManagedAgentAuthorityPortFactory,
  ManagedAgentNamespace,
  ManagedAgentNamespaceReference,
  ManagedAgentRuntimePortFactory,
  ManagedAgentRuntimeProvisioningInput,
  SessionManagementPortFactory,
  SessionManagementPorts,
  SessionNavigationPortFactory,
  SessionNavigationPorts,
} from '@ta-agent/base-composition';
import type { StandaloneRuntimePorts } from '../../runtime/materialize-standalone-agent.js';
import type { StandaloneAgentConfig } from '../../types.js';
import type { SharedSqliteAgentResourceNamespace } from './types.js';
import type { ResolvedStandaloneManagedSqliteTableNames } from '../sqlite-table-naming.js';

export interface SharedSqliteStandalonePortFactories {
  readonly createAuthorityPorts: ManagedAgentAuthorityPortFactory<SharedSqliteAgentResourceNamespace>;
  readonly createRuntimePorts: ManagedAgentRuntimePortFactory<
    StandaloneAgentConfig,
    SharedSqliteAgentResourceNamespace,
    StandaloneRuntimePorts
  >;
  readonly createSessionManagementPorts: SessionManagementPortFactory<
    SharedSqliteAgentResourceNamespace,
    SessionManagementPorts
  >;
  readonly createSessionNavigationPorts: SessionNavigationPortFactory<
    SharedSqliteAgentResourceNamespace,
    SessionNavigationPorts
  >;
}

export function createSharedSqliteStandalonePortFactories(
  options: Readonly<{
    clock?: () => number;
    busyTimeoutMilliseconds?: number;
    tableNames: ResolvedStandaloneManagedSqliteTableNames;
  }>
): SharedSqliteStandalonePortFactories {
  const createPersistence = (
    namespace: ManagedAgentNamespace<SharedSqliteAgentResourceNamespace>,
    schemaMode?: 'existing'
  ) =>
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
    createAuthorityPorts: (
      namespace: ManagedAgentNamespaceReference<SharedSqliteAgentResourceNamespace>
    ) =>
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
    }: ManagedAgentRuntimeProvisioningInput<
      StandaloneAgentConfig,
      SharedSqliteAgentResourceNamespace
    >) => {
      const { session, requestJournal } = createPersistence(namespace);
      return Object.freeze({ session, requestJournal });
    },
    createSessionManagementPorts: (
      namespace: ManagedAgentNamespace<SharedSqliteAgentResourceNamespace>
    ) => {
      const { session, maintenance } = createPersistence(namespace, 'existing');
      return Object.freeze({ session, maintenance });
    },
    createSessionNavigationPorts: (
      namespace: ManagedAgentNamespace<SharedSqliteAgentResourceNamespace>
    ) =>
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
