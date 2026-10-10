import {
  createAgentManagementService,
  createAgentRuntimeService,
  type ManagedAgentCompositionDefinition,
  type ManagedAgentCommitResult,
  type ManagedAgentSnapshot,
} from '@ta-agent/base-composition';
import { parseAgentId } from '@ta-agent/base-identity';
import { defineStandaloneAgentConfig, defineStandaloneAgentManifest } from '../../src/config.js';
import type {
  StandaloneAgentConfig,
  StandaloneAgentConfigInput,
  StandaloneAgentManifestInput,
  StandaloneRawAgent,
} from '../../src/types.js';

export interface ManagedProfileHarness {
  create(
    input: StandaloneAgentManifestInput
  ): Promise<ManagedAgentCommitResult<StandaloneAgentConfig>>;
  inspect(agentId: string): Promise<ManagedAgentSnapshot<StandaloneAgentConfig>>;
  list(): Promise<readonly ManagedAgentSnapshot<StandaloneAgentConfig>[]>;
  updateConfig(input: {
    readonly agentId: string;
    readonly config: StandaloneAgentConfigInput;
    readonly expectedRevision: number;
  }): Promise<ManagedAgentCommitResult<StandaloneAgentConfig>>;
  disable(input: {
    readonly agentId: string;
    readonly expectedRevision: number;
  }): Promise<ManagedAgentCommitResult<StandaloneAgentConfig>>;
  reactivate(input: {
    readonly agentId: string;
    readonly expectedRevision: number;
  }): Promise<ManagedAgentCommitResult<StandaloneAgentConfig>>;
  open(agentId: string): Promise<StandaloneRawAgent>;
}

export function createManagedProfileHarness<TNamespaceHandle, TRuntimePorts>(
  definition: ManagedAgentCompositionDefinition<
    StandaloneAgentConfig,
    TNamespaceHandle,
    TRuntimePorts,
    StandaloneRawAgent
  >
): ManagedProfileHarness {
  const management = createAgentManagementService(definition);
  const runtime = createAgentRuntimeService(definition);
  return Object.freeze({
    create: (input: StandaloneAgentManifestInput) => {
      const manifest = defineStandaloneAgentManifest(input);
      return management.create({ identity: manifest.identity, config: manifest.config });
    },
    inspect: (agentId: string) => management.inspect(parseAgentId(agentId)),
    list: () => management.list(),
    updateConfig: (input: {
      readonly agentId: string;
      readonly config: StandaloneAgentConfigInput;
      readonly expectedRevision: number;
    }) =>
      management.updateConfig({
        agentId: parseAgentId(input.agentId),
        config: defineStandaloneAgentConfig(input.config),
        expectedRevision: input.expectedRevision,
      }),
    disable: (input: { readonly agentId: string; readonly expectedRevision: number }) =>
      management.disable({
        agentId: parseAgentId(input.agentId),
        expectedIdentityRevision: input.expectedRevision,
      }),
    reactivate: (input: { readonly agentId: string; readonly expectedRevision: number }) =>
      management.reactivate({
        agentId: parseAgentId(input.agentId),
        expectedIdentityRevision: input.expectedRevision,
      }),
    open: (agentId: string) => runtime.open(parseAgentId(agentId)),
  });
}
