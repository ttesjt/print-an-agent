import { randomUUID } from 'node:crypto';
import { createManagedStandaloneAgentRegistry } from '../managed-agent/lifecycle.js';
import { createFilesystemStandaloneManifestProjection } from '../resources/filesystem/manifest-projection.js';
import { createFilesystemAgentResourceNamespaceAdapter } from '../resources/filesystem/namespace-adapter.js';
import { createFilesystemManagedAgentPortFactory } from '../resources/filesystem/port-factory.js';
import type { CreateStandaloneAgentDirectoryOptions, StandaloneAgentDirectory } from '../types.js';
import { resolveStandaloneManagedSqliteTableNames } from '../resources/sqlite-table-naming.js';

export function createStandaloneAgentDirectory(
  options: CreateStandaloneAgentDirectoryOptions
): StandaloneAgentDirectory {
  const createTemporaryId = options.createTemporaryId ?? randomUUID;
  const tableNames = resolveStandaloneManagedSqliteTableNames(options.sqlite);
  return createManagedStandaloneAgentRegistry({
    namespaces: createFilesystemAgentResourceNamespaceAdapter({
      rootDirectory: options.rootDirectory,
      createTemporaryId,
    }),
    ports: createFilesystemManagedAgentPortFactory({
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      tableNames,
    }),
    manifestProjection: createFilesystemStandaloneManifestProjection({ createTemporaryId }),
    readEnvironmentVariable: options.readEnvironmentVariable,
    ...(options.stepOverrides === undefined ? {} : { stepOverrides: options.stepOverrides }),
  });
}
