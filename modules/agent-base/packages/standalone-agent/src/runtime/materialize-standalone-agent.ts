import {
  composeAgent,
  createProviderRuntime,
  CONTEXT_MEMORY_TOOL_NAMES,
} from '@print-an-agent/base-composition';
import {
  BUILT_IN_RESPONSIBILITIES,
  MAIN_ACTOR_ID,
  createActorCatalog,
  createResponsibilityCatalog,
} from '@print-an-agent/base-actor';
import type { AgentIdentity } from '@print-an-agent/base-identity';
import type { RequestJournalPort, RequestContextMemory } from '@print-an-agent/base-request';
import type { CompactableSessionPort } from '@print-an-agent/base-session';
import { createStandaloneCredentialResolver } from '../credential-resolver.js';
import { AgentBaseStandaloneError } from '../errors.js';
import { resolveStandaloneTextTokenCounter } from './token-counter.js';
import {
  resolveStandaloneRequestPolicy,
  resolveStandaloneSessionCompactionPolicy,
} from '../runtime-policies.js';
import type {
  StandaloneRawAgent,
  StandaloneAgentConfig,
  StandaloneRuntimeOptions,
} from '../types.js';

export interface StandaloneRuntimePorts {
  readonly session: CompactableSessionPort;
  readonly requestJournal: RequestJournalPort;
  readonly contextMemory?: RequestContextMemory;
  readonly contextMemoryToolAllowList?: readonly string[];
}

export interface StandaloneRuntimeMaterializationInput {
  readonly identity: AgentIdentity;
  readonly config: StandaloneAgentConfig;
  readonly ports: StandaloneRuntimePorts;
  readonly options: StandaloneRuntimeOptions;
}

/** Pure runtime assembly over explicitly provisioned, complete persistence Ports. */
export function materializeStandaloneAgentRuntime(
  input: StandaloneRuntimeMaterializationInput
): StandaloneRawAgent {
  if (input.ports?.session == null || input.ports.requestJournal == null) {
    throw new AgentBaseStandaloneError(
      'Standalone materialization requires complete persistence Ports.'
    );
  }
  const credentialResolver =
    input.config.credential === undefined
      ? undefined
      : createStandaloneCredentialResolver(input.config.credential, input.options);

  const textTokenCounter = resolveStandaloneTextTokenCounter(input.config.provider, input.options);
  const provider = createProviderRuntime({
    ...(textTokenCounter === undefined ? {} : { textTokenCounter }),
    config: input.config.provider.config,
    transportLivenessPolicy: input.config.provider.transportLivenessPolicy,
    ...(credentialResolver === undefined ? {} : { credentialResolver }),
  });
  return composeAgent({
    identity: input.identity,
    actorCatalog: createActorCatalog({
      actors: [
        {
          ...input.config.mainActor,
          id: MAIN_ACTOR_ID,
          engineId: provider.actorEngine.id,
          ...(input.ports.contextMemory === undefined
            ? {}
            : {
                allowedTools: input.ports.contextMemoryToolAllowList ?? CONTEXT_MEMORY_TOOL_NAMES,
              }),
        },
      ],
      engines: [provider.actorEngine],
    }),
    responsibilityCatalog: createResponsibilityCatalog({
      responsibilities:
        input.ports.contextMemory === undefined
          ? BUILT_IN_RESPONSIBILITIES
          : BUILT_IN_RESPONSIBILITIES.map((r) => ({
              ...r,
              allowedTools: [
                ...(r.allowedTools ?? []),
                ...(input.ports.contextMemoryToolAllowList ?? CONTEXT_MEMORY_TOOL_NAMES),
              ],
            })),
    }),
    session: input.ports.session,
    requestJournal: input.ports.requestJournal,
    ...(input.ports.contextMemory === undefined
      ? {}
      : {
          contextMemory: input.ports.contextMemory,
          productToolAllowList: input.ports.contextMemoryToolAllowList ?? CONTEXT_MEMORY_TOOL_NAMES,
          runtimeToolAllowList: input.ports.contextMemoryToolAllowList ?? CONTEXT_MEMORY_TOOL_NAMES,
        }),
    ...(input.options.stepOverrides === undefined
      ? {}
      : { stepOverrides: input.options.stepOverrides }),
    requestPolicy: resolveStandaloneRequestPolicy(
      input.config.request,
      input.options.requestLimits
    ),
    sessionCompactionPolicy: resolveStandaloneSessionCompactionPolicy(
      input.config.sessionCompaction
    ),
    ...(input.options.sessionCompactionTokenCounter === undefined
      ? {}
      : {
          sessionCompactionTokenCounter: input.options.sessionCompactionTokenCounter,
        }),
  });
}
