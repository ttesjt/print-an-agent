import {
  SqliteAgentConfigAdapter,
  SqliteAgentIdentityCatalogAdapter,
  SqliteRequestJournalAdapter,
  SqliteSessionAdapter,
} from '@ta-agent/base-local-adapters';
import type {
  AgentResourceNamespace,
  ManagedAgentResourcePortFactory,
} from '../../managed-agent/contracts.js';
import type { SharedSqliteAgentResourceNamespace } from './types.js';
import type { ResolvedStandaloneManagedSqliteTableNames } from '../sqlite-table-naming.js';

export function createSharedSqliteManagedAgentPortFactory(
  options: Readonly<{
    clock?: () => number;
    busyTimeoutMilliseconds?: number;
    tableNames: ResolvedStandaloneManagedSqliteTableNames;
  }>
): ManagedAgentResourcePortFactory<SharedSqliteAgentResourceNamespace> {
  return Object.freeze({
    createAuthorityPorts: (namespace: AgentResourceNamespace<SharedSqliteAgentResourceNamespace>) =>
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
    createRuntimePorts: (namespace: AgentResourceNamespace<SharedSqliteAgentResourceNamespace>) =>
      Object.freeze({
        session: new SqliteSessionAdapter({
          databasePath: namespace.handle.databasePath,
          ...(options.clock === undefined ? {} : { clock: options.clock }),
          ...(options.busyTimeoutMilliseconds === undefined
            ? {}
            : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
          tableNames: options.tableNames.session,
        }),
        requestJournal: new SqliteRequestJournalAdapter({
          databasePath: namespace.handle.databasePath,
          ...(options.clock === undefined ? {} : { clock: options.clock }),
          ...(options.busyTimeoutMilliseconds === undefined
            ? {}
            : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
          tableNames: options.tableNames.requestJournal,
        }),
      }),
  });
}
