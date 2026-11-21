import { defineManagedAgentComposition } from '@print-an-agent/base-composition';
import { STANDALONE_AGENT_CONFIG_CODEC } from '../../configuration/index.js';
import {
  assertStandaloneRuntimeOptions,
  materializeStandaloneAgentRuntime,
} from '../../runtime/index.js';
import { createStandaloneSqlitePortFactories } from '../../sqlite/index.js';
import { createSharedSqliteAgentResourceNamespaceAdapter } from './resources/namespace-adapter.js';
import { resolveStandaloneSharedSqliteTableNames } from './resources/resolve-table-names.js';
import type { SharedSqliteStandaloneDefinition } from './types/definition.js';
import type { SharedSqliteAgentResourceNamespace } from './types/namespace.js';
import type { CreateSharedSqliteStandaloneProfileOptions } from './types/options.js';

export function createSharedSqliteStandaloneDefinition(
  options: CreateSharedSqliteStandaloneProfileOptions
): SharedSqliteStandaloneDefinition {
  assertStandaloneRuntimeOptions(options);
  const tableNames = resolveStandaloneSharedSqliteTableNames(options.sqlite);
  const busyTimeout =
    options.busyTimeoutMilliseconds === undefined
      ? {}
      : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds };
  const ports = createStandaloneSqlitePortFactories<SharedSqliteAgentResourceNamespace>({
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
