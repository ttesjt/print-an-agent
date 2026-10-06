import {
  createAgentManagementService,
  createAgentRuntimeService,
  type ManagedAgentCompositionDefinition,
} from '@ta-agent/base-composition';
import { defineStandaloneAgentBootstrapConfig } from './config.js';
import { AgentBaseStandaloneError } from './errors.js';
import { createStandaloneMemoryDefinition } from './profiles/memory.js';
import { createSharedSqliteStandaloneDefinition } from './profiles/shared-sqlite.js';
import { assertStandaloneRuntimeOptions } from './runtime-policies.js';
import type {
  CreateStandaloneAgentOptions,
  StandaloneAgentBootstrapConfig,
  StandaloneAgentConfig,
  StandaloneRawAgent,
} from './types.js';
import type { StandaloneRuntimePorts } from './runtime/materialize-standalone-agent.js';

async function createAndOpen<TNamespace>(
  definition: ManagedAgentCompositionDefinition<
    StandaloneAgentConfig,
    TNamespace,
    StandaloneRuntimePorts,
    StandaloneRawAgent
  >,
  bootstrap: StandaloneAgentBootstrapConfig
): Promise<StandaloneRawAgent> {
  const { identity, provider, credential, mainActor, request, sessionCompaction } = bootstrap;
  await createAgentManagementService(definition).create({
    identity,
    config: {
      provider,
      ...(credential === undefined ? {} : { credential }),
      mainActor,
      request,
      sessionCompaction,
    },
  });
  // Creation is committed. An open failure does not roll authority back; callers may open again.
  return createAgentRuntimeService(definition).open(identity.id);
}

/** Initializes authority, then opens a raw Agent through the same canonical profile and Services. */
export async function createStandaloneAgent(
  input: unknown,
  runtimeOptions: CreateStandaloneAgentOptions
): Promise<StandaloneRawAgent> {
  assertStandaloneRuntimeOptions(runtimeOptions);
  const bootstrap = defineStandaloneAgentBootstrapConfig(input);
  if (bootstrap.persistence.kind === 'memory') {
    if (runtimeOptions.sqlite !== undefined) {
      throw new AgentBaseStandaloneError(
        'Standalone SQLite table naming cannot be configured for Memory persistence.'
      );
    }
    return createAndOpen(createStandaloneMemoryDefinition(runtimeOptions), bootstrap);
  }
  return createAndOpen(
    createSharedSqliteStandaloneDefinition({
      ...runtimeOptions,
      databasePath: bootstrap.persistence.databasePath,
    }),
    bootstrap
  );
}
