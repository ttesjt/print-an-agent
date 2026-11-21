import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
  defineManagedAgentComposition,
  type SessionManagedAgentCompositionDefinition,
  type SessionManagementPorts,
  type SessionNavigationCapability,
  type SessionNavigationPorts,
} from '@print-an-agent/base-composition';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { StandaloneAgentConfig } from '../configuration/index.js';
import { STANDALONE_AGENT_CONFIG_CODEC } from '../configuration/index.js';
import type { StandaloneMemoryManagementOptions } from '../resources/agent-memory/contracts.js';
import { withStandaloneMemoryManagement } from '../resources/agent-memory/setup.js';
import { createFilesystemStandaloneManifestProjection } from '../resources/filesystem/manifest-projection.js';
import { createFilesystemAgentResourceNamespaceAdapter } from '../resources/filesystem/namespace-adapter.js';
import { createFilesystemStandalonePortFactories } from '../resources/filesystem/port-factory.js';
import type { FilesystemAgentResourceNamespace } from '../resources/filesystem/types.js';
import { reopenableStandaloneSetup } from '../resources/reopenable-setup.js';
import { resolveStandaloneManagedSqliteTableNames } from '../resources/sqlite-table-naming.js';
import type { StandaloneRawAgent } from '../runtime/index.js';
import {
  assertStandaloneRuntimeOptions,
  materializeStandaloneAgentRuntime,
  type StandaloneRuntimePorts,
} from '../runtime/index.js';
import {
  projectStandaloneAgentManagementService,
  type StandaloneAgentManagementService,
} from '../services/management-service.js';
import {
  projectStandaloneAgentRuntimeService,
  type StandaloneAgentRuntimeService,
} from '../services/runtime-service.js';
import {
  projectStandaloneSessionManagementService,
  type StandaloneSessionManagementService,
} from '../services/session-management-service.js';
import {
  projectStandaloneSessionNavigationService,
  type StandaloneSessionNavigationService,
} from '../services/session-navigation-service.js';
import type {
  CreateStandaloneDirectoryManagementServiceOptions,
  CreateStandaloneDirectoryNavigationServiceOptions,
  CreateStandaloneDirectoryProfileOptions,
  CreateStandaloneDirectorySessionServiceOptions,
} from '../types.js';

export type StandaloneDirectoryDefinition = SessionManagedAgentCompositionDefinition<
  StandaloneAgentConfig,
  FilesystemAgentResourceNamespace,
  StandaloneRuntimePorts,
  StandaloneRawAgent,
  SessionManagementPorts
> &
  SessionNavigationCapability<FilesystemAgentResourceNamespace, SessionNavigationPorts>;

export function createStandaloneDirectorySetup(
  options: CreateStandaloneDirectoryProfileOptions,
  memory?: StandaloneMemoryManagementOptions
) {
  return withStandaloneMemoryManagement(
    reopenableStandaloneSetup(createStandaloneDirectoryDefinition(options)),
    memory,
    (namespace) => ({
      key: namespace.handle.databasePath,
      contextPath: join(namespace.handle.directoryPath, 'context-memory.sqlite'),
      retrievalPath: join(namespace.handle.directoryPath, 'retrieval-memory.sqlite'),
    })
  );
}

export function createStandaloneDirectoryDefinition(
  options: CreateStandaloneDirectoryProfileOptions
): StandaloneDirectoryDefinition {
  assertStandaloneRuntimeOptions(options);
  const createTemporaryId = options.createTemporaryId ?? randomUUID;
  const tableNames = resolveStandaloneManagedSqliteTableNames(options.sqlite);
  const ports = createFilesystemStandalonePortFactories({
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

export function createStandaloneDirectoryManagementService(
  options: CreateStandaloneDirectoryManagementServiceOptions
): StandaloneAgentManagementService {
  return projectStandaloneAgentManagementService(
    createAgentManagementService(
      createStandaloneDirectoryDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}

export function createStandaloneDirectoryRuntimeService(
  options: CreateStandaloneDirectoryProfileOptions
): StandaloneAgentRuntimeService {
  return projectStandaloneAgentRuntimeService(
    createAgentRuntimeService(createStandaloneDirectoryDefinition(options))
  );
}

export function createStandaloneDirectorySessionService(
  options: CreateStandaloneDirectorySessionServiceOptions
): StandaloneSessionManagementService {
  return projectStandaloneSessionManagementService(
    createSessionManagementService(
      createStandaloneDirectoryDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}

export function createStandaloneDirectorySessionNavigationService(
  options: CreateStandaloneDirectoryNavigationServiceOptions
): StandaloneSessionNavigationService {
  return projectStandaloneSessionNavigationService(
    createSessionNavigationService(
      createStandaloneDirectoryDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}
