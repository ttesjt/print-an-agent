import { defineManagedAgentComposition } from '@print-an-agent/base-composition';
import type { StandaloneMemoryManagementOptions } from '../../agent-memory/index.js';
import { withStandaloneMemoryManagement } from '../../agent-memory/index.js';
import { STANDALONE_AGENT_CONFIG_CODEC } from '../../configuration/index.js';
import { AgentBaseStandaloneError } from '../../errors.js';
import {
  assertStandaloneRuntimeOptions,
  materializeStandaloneAgentRuntime,
} from '../../runtime/index.js';
import { createMemoryStandaloneResourceProvisioner } from './resources/provisioner.js';
import type { StandaloneMemoryDefinition, StandaloneMemorySetup } from './types/definition.js';
import type { CreateStandaloneMemoryProfileOptions } from './types/options.js';

/** The caller retains this setup for the entire lifetime of its Services and raw Agents. */
export function createStandaloneMemorySetup(
  options: CreateStandaloneMemoryProfileOptions,
  memory?: StandaloneMemoryManagementOptions
): StandaloneMemorySetup {
  assertStandaloneRuntimeOptions(options);
  if (options.acquireAuthority !== undefined && typeof options.acquireAuthority !== 'function')
    throw new AgentBaseStandaloneError('Memory authority acquisition must be a function.');
  if (
    options.acquireSessionPersistence !== undefined &&
    typeof options.acquireSessionPersistence !== 'function'
  )
    throw new AgentBaseStandaloneError('Memory persistence acquisition must be a function.');
  if (Object.hasOwn(options, 'sqlite'))
    throw new AgentBaseStandaloneError('SQLite table naming is not applicable to a Memory setup.');
  const { clock, acquireAuthority, acquireSessionPersistence, ...runtime } = options;
  const runtimeOptions = Object.freeze(runtime);
  const resources = createMemoryStandaloneResourceProvisioner({
    ...(clock === undefined ? {} : { clock }),
    ...(acquireAuthority === undefined ? {} : { acquireAuthority }),
    ...(acquireSessionPersistence === undefined ? {} : { acquireSessionPersistence }),
  });
  const definition: StandaloneMemoryDefinition = defineManagedAgentComposition({
    config: { codec: STANDALONE_AGENT_CONFIG_CODEC },
    namespace: { port: resources.namespacePort },
    authority: { createPorts: resources.createAuthorityPorts },
    runtime: {
      createPorts: resources.createRuntimePorts,
      materialize: ({ identity, config, ports }) =>
        materializeStandaloneAgentRuntime({ identity, config, ports, options: runtimeOptions }),
    },
    sessionManagement: { createPorts: resources.createSessionManagementPorts },
    sessionNavigation: { createPorts: resources.createSessionNavigationPorts },
  });
  return withStandaloneMemoryManagement(
    Object.freeze({ definition, close: resources.close }),
    memory,
    (namespace) => ({
      key: namespace.handle.token,
      contextPath: ':memory:',
      retrievalPath: ':memory:',
    })
  );
}
