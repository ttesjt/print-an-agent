import {
  BUILT_IN_RESPONSIBILITIES,
  MAIN_ACTOR_ID,
  createActorCatalog,
  createResponsibilityCatalog,
} from '@print-an-agent/base-actor';
import { CONTEXT_MEMORY_TOOL_NAMES, composeAgent } from '@print-an-agent/base-composition';
import { AgentBaseStandaloneError } from '../errors.js';
import { createStandaloneProviderRuntime } from '../provider/index.js';
import {
  resolveStandaloneRequestPolicy,
  resolveStandaloneSessionCompactionPolicy,
} from './policies.js';
import type { StandaloneRawAgent } from './types/agent.js';
import type { StandaloneRuntimeMaterializationInput } from './types/ports.js';

/** Pure runtime assembly over explicitly provisioned, complete persistence Ports. */
export function materializeStandaloneAgentRuntime(
  input: StandaloneRuntimeMaterializationInput
): StandaloneRawAgent {
  if (input.ports?.session == null || input.ports.requestJournal == null) {
    throw new AgentBaseStandaloneError(
      'Standalone materialization requires complete persistence Ports.'
    );
  }
  const provider = createStandaloneProviderRuntime(input.config, input.options);
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
