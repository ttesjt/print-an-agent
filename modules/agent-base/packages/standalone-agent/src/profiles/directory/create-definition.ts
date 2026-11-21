import { defineManagedAgentComposition } from '@print-an-agent/base-composition';
import { randomUUID } from 'node:crypto';
import { STANDALONE_AGENT_CONFIG_CODEC } from '../../configuration/index.js';
import {
  assertStandaloneRuntimeOptions,
  materializeStandaloneAgentRuntime,
} from '../../runtime/index.js';
import {
  createStandaloneSqlitePortFactories,
  resolveStandaloneManagedSqliteTableNames,
} from '../../sqlite/index.js';
import { createFilesystemStandaloneManifestProjection } from './resources/manifest-projection.js';
import { createFilesystemAgentResourceNamespaceAdapter } from './resources/namespace-adapter.js';
import type { StandaloneDirectoryDefinition } from './types/definition.js';
import type { FilesystemAgentResourceNamespace } from './types/namespace.js';
import type { CreateStandaloneDirectoryProfileOptions } from './types/options.js';

export function createStandaloneDirectoryDefinition(
  options: CreateStandaloneDirectoryProfileOptions
): StandaloneDirectoryDefinition {
  assertStandaloneRuntimeOptions(options);
  const createTemporaryId = options.createTemporaryId ?? randomUUID;
  const tableNames = resolveStandaloneManagedSqliteTableNames(options.sqlite);
  const ports = createStandaloneSqlitePortFactories<FilesystemAgentResourceNamespace>({
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    tableNames,
  });

  return defineManagedAgentComposition({
    config: { codec: STANDALONE_AGENT_CONFIG_CODEC },
    namespace: {
      port: createFilesystemAgentResourceNamespaceAdapter({
        rootDirectory: options.rootDirectory,
        createTemporaryId,
      }),
    },
    authority: { createPorts: ports.createAuthorityPorts },
    runtime: {
      createPorts: ports.createRuntimePorts,
      materialize: ({ identity, config, ports: runtimePorts }) =>
        materializeStandaloneAgentRuntime({
          identity,
          config,
          ports: runtimePorts,
          options,
        }),
    },
    projection: {
      port: createFilesystemStandaloneManifestProjection({ createTemporaryId }),
    },
    sessionManagement: { createPorts: ports.createSessionManagementPorts },
    sessionNavigation: { createPorts: ports.createSessionNavigationPorts },
  });
}
