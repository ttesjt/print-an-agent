import {
  SqliteAgentConfigAdapter,
  SqliteAgentIdentityCatalogAdapter,
  createSqliteSessionPersistence,
} from '@ta-agent/base-local-adapters';
import type {
  AgentResourceNamespace,
  ManagedAgentResourcePortFactory,
} from '../../managed-agent/contracts.js';
import type { FilesystemAgentResourceNamespace } from './types.js';
import type { ResolvedStandaloneManagedSqliteTableNames } from '../sqlite-table-naming.js';

export function createFilesystemManagedAgentPortFactory(
  options: Readonly<{
    clock?: () => number;
    tableNames: ResolvedStandaloneManagedSqliteTableNames;
  }>
): ManagedAgentResourcePortFactory<FilesystemAgentResourceNamespace> {
  return Object.freeze({
    createAuthorityPorts: (namespace: AgentResourceNamespace<FilesystemAgentResourceNamespace>) =>
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
    createRuntimePorts: (namespace: AgentResourceNamespace<FilesystemAgentResourceNamespace>) => {
      const { session, requestJournal } = createSqliteSessionPersistence({
        databasePath: namespace.handle.databasePath,
        session: { tableNames: options.tableNames.session },
        requestJournal: { tableNames: options.tableNames.requestJournal },
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      });
      return Object.freeze({ session, requestJournal });
    },
  });
}
