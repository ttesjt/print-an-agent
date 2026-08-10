import { SqliteAgentConfigAdapter } from '@ta-agent/base-config';
import { SqliteAgentIdentityCatalogAdapter } from '@ta-agent/base-identity';
import { SqliteRequestJournalAdapter } from '@ta-agent/base-request';
import { SqliteSessionAdapter } from '@ta-agent/base-session';
import type {
  AgentResourceNamespace,
  ManagedAgentResourcePortFactory,
} from '../../managed-agent/contracts.js';
import type { SharedSqliteAgentResourceNamespace } from './types.js';

export function createSharedSqliteManagedAgentPortFactory(
  options: Readonly<{
    clock?: () => number;
    busyTimeoutMilliseconds?: number;
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
        }),
        config: new SqliteAgentConfigAdapter({
          databasePath: namespace.handle.databasePath,
          ...(options.busyTimeoutMilliseconds === undefined
            ? {}
            : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
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
        }),
        requestJournal: new SqliteRequestJournalAdapter({
          databasePath: namespace.handle.databasePath,
          ...(options.clock === undefined ? {} : { clock: options.clock }),
          ...(options.busyTimeoutMilliseconds === undefined
            ? {}
            : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
        }),
      }),
  });
}
