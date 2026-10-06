import {
  defineManagedAgentComposition,
  type SessionManagedAgentCompositionDefinition,
  type SessionManagementPorts,
} from '@ta-agent/base-composition';
import { STANDALONE_AGENT_CONFIG_CODEC } from '../config.js';
import {
  createMemoryStandaloneResourceProvisioner,
  type MemoryAgentResourceNamespace,
} from '../resources/memory/provisioner.js';
import {
  materializeStandaloneAgentRuntime,
  type StandaloneRuntimePorts,
} from '../runtime/materialize-standalone-agent.js';
import { assertStandaloneRuntimeOptions } from '../runtime-policies.js';
import type {
  CreateStandaloneMemoryProfileOptions,
  StandaloneAgentConfig,
  StandaloneRawAgent,
} from '../types.js';

export type StandaloneMemoryDefinition = SessionManagedAgentCompositionDefinition<
  StandaloneAgentConfig,
  MemoryAgentResourceNamespace,
  StandaloneRuntimePorts,
  StandaloneRawAgent,
  SessionManagementPorts
>;

/** Reuse this Definition across sibling Services to share one ephemeral provisioning scope. */
export function createStandaloneMemoryDefinition(
  options: CreateStandaloneMemoryProfileOptions
): StandaloneMemoryDefinition {
  assertStandaloneRuntimeOptions(options);
  const resources = createMemoryStandaloneResourceProvisioner({
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  return defineManagedAgentComposition({
    config: { codec: STANDALONE_AGENT_CONFIG_CODEC },
    namespace: { port: resources.namespacePort },
    authority: { createPorts: resources.createAuthorityPorts },
    runtime: {
      createPorts: resources.createRuntimePorts,
      materialize: ({ identity, config, ports }) =>
        materializeStandaloneAgentRuntime({ identity, config, ports, options }),
    },
    sessionManagement: { createPorts: resources.createSessionManagementPorts },
  });
}
