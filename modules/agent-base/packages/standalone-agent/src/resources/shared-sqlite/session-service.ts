import { createSqliteSessionPersistence } from '@ta-agent/base-local-adapters';
import { createManagedStandaloneSessionService } from '../../managed-session/service.js';
import { createSharedSqliteAgentResourceNamespaceAdapter } from './namespace-adapter.js';
import { resolveStandaloneSharedSqliteTableNames } from '../sqlite-table-naming.js';
import type { CreateSharedSqliteStandaloneAgentRegistryOptions } from '../../types.js';
import type { ManagedStandaloneSessionService } from '../../managed-session/contracts.js';

export type CreateSharedSqliteStandaloneSessionServiceOptions = Pick<
  CreateSharedSqliteStandaloneAgentRegistryOptions,
  'databasePath' | 'clock' | 'busyTimeoutMilliseconds' | 'sqlite'
>;

export function createSharedSqliteStandaloneSessionService(
  options: CreateSharedSqliteStandaloneSessionServiceOptions
): ManagedStandaloneSessionService {
  const tableNames = resolveStandaloneSharedSqliteTableNames(options.sqlite);
  return createManagedStandaloneSessionService({
    namespaces: createSharedSqliteAgentResourceNamespaceAdapter({
      databasePath: options.databasePath,
      ...(options.busyTimeoutMilliseconds === undefined
        ? {}
        : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
      tableNames: tableNames.managedNamespace,
    }),
    ports: {
      createSessionManagementPorts: (namespace) => {
        const { session, maintenance } = createSqliteSessionPersistence({
          databasePath: namespace.handle.databasePath,
          schemaMode: 'existing',
          session: { tableNames: tableNames.session },
          requestJournal: { tableNames: tableNames.requestJournal },
          ...(options.clock === undefined ? {} : { clock: options.clock }),
          ...(options.busyTimeoutMilliseconds === undefined
            ? {}
            : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
        });
        return Object.freeze({ session, maintenance });
      },
    },
  });
}
