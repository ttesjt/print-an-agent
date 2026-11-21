import {
  defineManagedAgentComposition,
  type SessionManagedAgentCompositionDefinition,
  type SessionManagementPorts,
  type SessionNavigationCapability,
  type SessionNavigationPorts,
} from '@print-an-agent/base-composition';
import type { StandaloneAgentConfig } from '../configuration/index.js';
import { STANDALONE_AGENT_CONFIG_CODEC } from '../configuration/index.js';
import { AgentBaseStandaloneError } from '../errors.js';
import type { StandaloneMemoryManagementOptions } from '../resources/agent-memory/contracts.js';
import type {
  MemoryManagedStandaloneDefinition,
  StandaloneSessionContextMemory,
} from '../resources/agent-memory/setup.js';
import { withStandaloneMemoryManagement } from '../resources/agent-memory/setup.js';
import {
  createMemoryStandaloneResourceProvisioner,
  type MemoryAgentResourceNamespace,
} from '../resources/memory/provisioner.js';
import type { StandaloneRawAgent } from '../runtime/index.js';
import {
  assertStandaloneRuntimeOptions,
  materializeStandaloneAgentRuntime,
  type StandaloneRuntimePorts,
} from '../runtime/index.js';
import type { CreateStandaloneMemoryProfileOptions } from '../types.js';
import type { StandaloneSetup } from './setup.js';

export type StandaloneMemoryDefinition = SessionManagedAgentCompositionDefinition<
  StandaloneAgentConfig,
  MemoryAgentResourceNamespace,
  StandaloneRuntimePorts,
  StandaloneRawAgent,
  SessionManagementPorts
> &
  SessionNavigationCapability<MemoryAgentResourceNamespace, SessionNavigationPorts>;

export interface StandaloneMemorySetup extends StandaloneSetup<MemoryAgentResourceNamespace> {
  readonly definition: MemoryManagedStandaloneDefinition<MemoryAgentResourceNamespace>;
  readonly sessionContextMemory?: StandaloneSessionContextMemory;
}

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
