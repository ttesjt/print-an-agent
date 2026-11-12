import {
  createAgentManagementService,
  createAgentRuntimeService,
} from '@print-an-agent/base-composition';
import { parseAgentId, type AgentIdentityInput } from '@print-an-agent/base-identity';
import { defineStandaloneAgentConfig } from './config.js';
import type { StandaloneSetup } from './profiles/setup.js';
import type { StandaloneAgentConfigInput, StandaloneRawAgent } from './types.js';

/** Initializes authority, then opens a raw Agent. The caller always owns and closes setup. */
export async function createStandaloneAgent<N>(
  setup: StandaloneSetup<N>,
  input: Readonly<{ identity: AgentIdentityInput; config: StandaloneAgentConfigInput }>
): Promise<StandaloneRawAgent> {
  const config = defineStandaloneAgentConfig(input.config);
  const created = await createAgentManagementService(setup.definition).create({
    identity: input.identity,
    config,
  });
  // Publication is committed. An open failure cannot roll it back; setup remains caller-owned.
  return createAgentRuntimeService(setup.definition).open(created.authority.identity.identity.id);
}

/** Opens existing authority through a caller-owned setup; does not create or transfer resource ownership. */
export function openStandaloneAgent<N>(
  setup: StandaloneSetup<N>,
  agentId: string
): Promise<StandaloneRawAgent> {
  return createAgentRuntimeService(setup.definition).open(parseAgentId(agentId));
}
