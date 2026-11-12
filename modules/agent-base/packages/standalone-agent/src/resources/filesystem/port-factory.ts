import {
  SqliteAgentConfigAdapter,
  SqliteAgentIdentityCatalogAdapter,
  SqliteSessionAdapter,
  createSqliteSessionPersistence,
} from '@print-an-agent/base-local-adapters';
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
} from '@print-an-agent/base-composition';
import type { StandaloneRuntimePorts } from '../../runtime/materialize-standalone-agent.js';
import type { StandaloneAgentConfig } from '../../types.js';
import type { FilesystemAgentResourceNamespace } from './types.js';
import type { ResolvedStandaloneManagedSqliteTableNames } from '../sqlite-table-naming.js';

export interface FilesystemStandalonePortFactories {
  readonly createAuthorityPorts: ManagedAgentAuthorityPortFactory<FilesystemAgentResourceNamespace>;
  readonly createRuntimePorts: ManagedAgentRuntimePortFactory<
    StandaloneAgentConfig,
    FilesystemAgentResourceNamespace,
    StandaloneRuntimePorts
  >;
  readonly createSessionManagementPorts: SessionManagementPortFactory<
    FilesystemAgentResourceNamespace,
    SessionManagementPorts
  >;
  readonly createSessionNavigationPorts: SessionNavigationPortFactory<
    FilesystemAgentResourceNamespace,
    SessionNavigationPorts
  >;
}

export function createFilesystemStandalonePortFactories(
  options: Readonly<{
    clock?: () => number;
    tableNames: ResolvedStandaloneManagedSqliteTableNames;
  }>
): FilesystemStandalonePortFactories {
  const createPersistence = (
    namespace: ManagedAgentNamespace<FilesystemAgentResourceNamespace>,
    schemaMode?: 'existing'
  ) =>
    createSqliteSessionPersistence({
      databasePath: namespace.handle.databasePath,
      ...(schemaMode === undefined ? {} : { schemaMode }),
      session: { tableNames: options.tableNames.session },
      requestJournal: { tableNames: options.tableNames.requestJournal },
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });

  return Object.freeze({
    createAuthorityPorts: (
      namespace: ManagedAgentNamespaceReference<FilesystemAgentResourceNamespace>
    ) =>
      Object.freeze({
        identityCatalog: new SqliteAgentIdentityCatalogAdapter({
          databasePath: namespace.handle.databasePath,
          ...(options.clock === undefined ? {} : { clock: options.clock }),
          tableNames: options.tableNames.identity,
        }),
        config: new SqliteAgentConfigAdapter({
          databasePath: namespace.handle.databasePath,
          tableNames: options.tableNames.config,
        }),
      }),
    createRuntimePorts: ({
      namespace,
    }: ManagedAgentRuntimeProvisioningInput<
      StandaloneAgentConfig,
      FilesystemAgentResourceNamespace
    >) => {
      const { session, requestJournal } = createPersistence(namespace);
      return Object.freeze({ session, requestJournal });
    },
    createSessionManagementPorts: (
      namespace: ManagedAgentNamespace<FilesystemAgentResourceNamespace>
    ) => {
      const { session, maintenance } = createPersistence(namespace, 'existing');
      return Object.freeze({ session, maintenance });
    },
    createSessionNavigationPorts: (
      namespace: ManagedAgentNamespace<FilesystemAgentResourceNamespace>
    ) =>
      Object.freeze({
        session: new SqliteSessionAdapter({
          databasePath: namespace.handle.databasePath,
          schemaMode: 'existing',
          tableNames: options.tableNames.session,
          ...(options.clock === undefined ? {} : { clock: options.clock }),
        }),
      }),
  });
}
