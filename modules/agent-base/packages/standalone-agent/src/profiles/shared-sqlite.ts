import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
  defineManagedAgentComposition,
  type SessionNavigationCapability,
  type SessionNavigationPorts,
  type SessionManagedAgentCompositionDefinition,
  type SessionManagementPorts,
} from '@print-an-agent/base-composition';
import { withStandaloneMemoryManagement } from '../resources/agent-memory/setup.js';
import type { StandaloneMemoryManagementOptions } from '../resources/agent-memory/contracts.js';
import { STANDALONE_AGENT_CONFIG_CODEC } from '../config.js';
import { resolveStandaloneSharedSqliteTableNames } from '../resources/sqlite-table-naming.js';
import { createSharedSqliteAgentResourceNamespaceAdapter } from '../resources/shared-sqlite/namespace-adapter.js';
import { createSharedSqliteStandalonePortFactories } from '../resources/shared-sqlite/port-factory.js';
import type { SharedSqliteAgentResourceNamespace } from '../resources/shared-sqlite/types.js';
import { assertStandaloneRuntimeOptions } from '../runtime-policies.js';
import { reopenableStandaloneSetup } from '../resources/reopenable-setup.js';
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
import {
  materializeStandaloneAgentRuntime,
  type StandaloneRuntimePorts,
} from '../runtime/materialize-standalone-agent.js';
import type {
  CreateSharedSqliteStandaloneProfileOptions,
  CreateSharedSqliteStandaloneManagementServiceOptions,
  CreateSharedSqliteStandaloneSessionServiceOptions,
  CreateSharedSqliteStandaloneNavigationServiceOptions,
  StandaloneAgentConfig,
  StandaloneRawAgent,
} from '../types.js';

export type SharedSqliteStandaloneDefinition = SessionManagedAgentCompositionDefinition<
  StandaloneAgentConfig,
  SharedSqliteAgentResourceNamespace,
  StandaloneRuntimePorts,
  StandaloneRawAgent,
  SessionManagementPorts
> &
  SessionNavigationCapability<SharedSqliteAgentResourceNamespace, SessionNavigationPorts>;

export function createSharedSqliteStandaloneSetup(
  options: CreateSharedSqliteStandaloneProfileOptions,
  memory?: StandaloneMemoryManagementOptions
) {
  return withStandaloneMemoryManagement(
    reopenableStandaloneSetup(createSharedSqliteStandaloneDefinition(options)),
    memory,
    (namespace) => ({
      key: JSON.stringify([namespace.handle.databasePath, namespace.agentId]),
      contextPath: `${namespace.handle.databasePath}.context-memory.sqlite`,
      retrievalPath: `${namespace.handle.databasePath}.retrieval-memory.sqlite`,
    })
  );
}

export function createSharedSqliteStandaloneDefinition(
  options: CreateSharedSqliteStandaloneProfileOptions
): SharedSqliteStandaloneDefinition {
  assertStandaloneRuntimeOptions(options);
  const tableNames = resolveStandaloneSharedSqliteTableNames(options.sqlite);
  const busyTimeout =
    options.busyTimeoutMilliseconds === undefined
      ? {}
      : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds };
  const ports = createSharedSqliteStandalonePortFactories({
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...busyTimeout,
    tableNames,
  });

  return defineManagedAgentComposition({
    config: { codec: STANDALONE_AGENT_CONFIG_CODEC },
    namespace: {
      port: createSharedSqliteAgentResourceNamespaceAdapter({
        databasePath: options.databasePath,
        ...busyTimeout,
        tableNames: tableNames.managedNamespace,
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
    sessionManagement: { createPorts: ports.createSessionManagementPorts },
    sessionNavigation: { createPorts: ports.createSessionNavigationPorts },
  });
}

export function createSharedSqliteStandaloneManagementService(
  options: CreateSharedSqliteStandaloneManagementServiceOptions
): StandaloneAgentManagementService {
  return projectStandaloneAgentManagementService(
    createAgentManagementService(
      createSharedSqliteStandaloneDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}

export function createSharedSqliteStandaloneRuntimeService(
  options: CreateSharedSqliteStandaloneProfileOptions
): StandaloneAgentRuntimeService {
  return projectStandaloneAgentRuntimeService(
    createAgentRuntimeService(createSharedSqliteStandaloneDefinition(options))
  );
}

export function createSharedSqliteStandaloneSessionService(
  options: CreateSharedSqliteStandaloneSessionServiceOptions
): StandaloneSessionManagementService {
  return projectStandaloneSessionManagementService(
    createSessionManagementService(
      createSharedSqliteStandaloneDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}

export function createSharedSqliteStandaloneSessionNavigationService(
  options: CreateSharedSqliteStandaloneNavigationServiceOptions
): StandaloneSessionNavigationService {
  return projectStandaloneSessionNavigationService(
    createSessionNavigationService(
      createSharedSqliteStandaloneDefinition({
        ...options,
        readEnvironmentVariable: () => undefined,
      })
    )
  );
}
