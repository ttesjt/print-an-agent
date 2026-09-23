import { randomUUID } from 'node:crypto';
import { createSqliteSessionPersistence } from '@ta-agent/base-local-adapters';
import { createManagedStandaloneSessionService } from '../managed-session/service.js';
import { createFilesystemAgentResourceNamespaceAdapter } from '../resources/filesystem/namespace-adapter.js';
import { resolveStandaloneManagedSqliteTableNames } from '../resources/sqlite-table-naming.js';
import type { CreateStandaloneAgentDirectoryOptions } from '../types.js';
import type { ManagedStandaloneSessionService } from '../managed-session/contracts.js';

export type CreateStandaloneDirectorySessionServiceOptions = Pick<
  CreateStandaloneAgentDirectoryOptions,
  'rootDirectory' | 'clock' | 'createTemporaryId' | 'sqlite'
>;

export function createStandaloneDirectorySessionService(
  options: CreateStandaloneDirectorySessionServiceOptions
): ManagedStandaloneSessionService {
  const tableNames = resolveStandaloneManagedSqliteTableNames(options.sqlite);
  return createManagedStandaloneSessionService({
    namespaces: createFilesystemAgentResourceNamespaceAdapter({
      rootDirectory: options.rootDirectory,
      createTemporaryId: options.createTemporaryId ?? randomUUID,
    }),
    ports: {
      createSessionManagementPorts: (namespace) => {
        const { session, maintenance } = createSqliteSessionPersistence({
          databasePath: namespace.handle.databasePath,
          schemaMode: 'existing',
          session: { tableNames: tableNames.session },
          requestJournal: { tableNames: tableNames.requestJournal },
          ...(options.clock === undefined ? {} : { clock: options.clock }),
        });
        return Object.freeze({ session, maintenance });
      },
    },
  });
}
