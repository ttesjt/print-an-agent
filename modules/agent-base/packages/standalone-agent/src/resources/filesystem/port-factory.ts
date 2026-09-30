import {
  SqliteAgentConfigAdapter,
  SqliteAgentIdentityCatalogAdapter,
  createSqliteSessionPersistence,
} from '@ta-agent/base-local-adapters';
import type {
  ManagedAgentAuthorityPortFactory,
  ManagedAgentNamespace,
  ManagedAgentNamespaceReference,
  ManagedAgentRuntimePortFactory,
  SessionManagementPortFactory,
  SessionManagementPorts,
} from '@ta-agent/base-composition';
import type { StandaloneRuntimePorts } from '../../runtime/materialize-standalone-agent.js';
import type { FilesystemAgentResourceNamespace } from './types.js';
import type { ResolvedStandaloneManagedSqliteTableNames } from '../sqlite-table-naming.js';

export interface FilesystemStandalonePortFactories {
  readonly createAuthorityPorts: ManagedAgentAuthorityPortFactory<FilesystemAgentResourceNamespace>;
  readonly createRuntimePorts: ManagedAgentRuntimePortFactory<
    FilesystemAgentResourceNamespace,
    StandaloneRuntimePorts
  >;
  readonly createSessionManagementPorts: SessionManagementPortFactory<
    FilesystemAgentResourceNamespace,
    SessionManagementPorts
  >;
}

export function createFilesystemStandalonePortFactories(
  options: Readonly<{
    clock?: () => number;
    tableNames: ResolvedStandaloneManagedSqliteTableNames;
  }>
): FilesystemStandalonePortFactories {
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
    createRuntimePorts: (namespace: ManagedAgentNamespace<FilesystemAgentResourceNamespace>) => {
      const { session, requestJournal } = createSqliteSessionPersistence({
        databasePath: namespace.handle.databasePath,
        session: { tableNames: options.tableNames.session },
        requestJournal: { tableNames: options.tableNames.requestJournal },
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      });
      return Object.freeze({ session, requestJournal });
    },
    createSessionManagementPorts: (
      namespace: ManagedAgentNamespace<FilesystemAgentResourceNamespace>
    ) => {
      const { session, maintenance } = createSqliteSessionPersistence({
        databasePath: namespace.handle.databasePath,
        schemaMode: 'existing',
        session: { tableNames: options.tableNames.session },
        requestJournal: { tableNames: options.tableNames.requestJournal },
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      });
      return Object.freeze({ session, maintenance });
    },
  });
}
