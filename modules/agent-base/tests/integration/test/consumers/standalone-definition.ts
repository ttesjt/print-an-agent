import { createAgentRuntimeService } from '@print-an-agent/base-composition';
import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import {
  createStandaloneMemorySetup,
  type CreateStandaloneMemoryProfileOptions,
  type StandaloneSetup,
} from '@print-an-agent/base-standalone-agent';

/** Public consumer inference must emit portable Config, namespace and raw Agent declarations. */
export function standaloneDefinition(options: CreateStandaloneMemoryProfileOptions) {
  return createStandaloneMemorySetup(options).definition;
}

export function openExternalStandalone(
  setup: StandaloneSetup<{ readonly externalReference: string }>,
  agentId: AgentId
) {
  return createAgentRuntimeService(setup.definition).open(agentId);
}
