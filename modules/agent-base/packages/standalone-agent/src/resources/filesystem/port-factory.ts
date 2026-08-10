import { SqliteAgentConfigAdapter } from '@ta-agent/base-config';
import { SqliteAgentIdentityCatalogAdapter } from '@ta-agent/base-identity';
import { SqliteRequestJournalAdapter } from '@ta-agent/base-request';
import { SqliteSessionAdapter } from '@ta-agent/base-session';
import type {
  AgentResourceNamespace,
  ManagedAgentResourcePortFactory,
} from '../../managed-agent/contracts.js';
import type { FilesystemAgentResourceNamespace } from './types.js';

export function createFilesystemManagedAgentPortFactory(
  options: Readonly<{
    clock?: () => number;
  }>
): ManagedAgentResourcePortFactory<FilesystemAgentResourceNamespace> {
  return Object.freeze({
    createAuthorityPorts: (namespace: AgentResourceNamespace<FilesystemAgentResourceNamespace>) =>
      Object.freeze({
        identityCatalog: new SqliteAgentIdentityCatalogAdapter({
          databasePath: namespace.handle.databasePath,
          ...(options.clock === undefined ? {} : { clock: options.clock }),
        }),
        config: new SqliteAgentConfigAdapter({ databasePath: namespace.handle.databasePath }),
      }),
    createRuntimePorts: (namespace: AgentResourceNamespace<FilesystemAgentResourceNamespace>) =>
      Object.freeze({
        session: new SqliteSessionAdapter({ databasePath: namespace.handle.databasePath }),
        requestJournal: new SqliteRequestJournalAdapter({
          databasePath: namespace.handle.databasePath,
        }),
      }),
  });
}
