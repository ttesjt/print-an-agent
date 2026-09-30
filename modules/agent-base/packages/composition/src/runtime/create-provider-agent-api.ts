import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@ta-agent/base-actor';
import { createAgentAPI } from './agent-api.js';
import { composeAgent } from './compose-agent.js';
import { createProviderRuntime } from './provider-runtime.js';
import type { CreateProviderAgentAPIOptions, ProviderAgentAPI } from './types.js';

export function createProviderAgentAPI(options: CreateProviderAgentAPIOptions): ProviderAgentAPI {
  const { provider, mainActor, responsibilities, ...baseOptions } = options;
  const providerProfile = createProviderRuntime(provider);
  const actorCatalog = createActorCatalog({
    actors: [
      {
        ...mainActor,
        id: MAIN_ACTOR_ID,
        engineId: providerProfile.actorEngine.id,
      },
    ],
    engines: [providerProfile.actorEngine],
  });
  const responsibilityCatalog = createResponsibilityCatalog({
    responsibilities: responsibilities ?? BUILT_IN_RESPONSIBILITIES,
  });
  const agent = composeAgent({
    ...baseOptions,
    actorCatalog,
    responsibilityCatalog,
  });

  return Object.freeze({
    ...createAgentAPI(agent),
    inspectProvider: () => providerProfile.inspect(),
    checkProviderReadiness: (readinessOptions?: Readonly<{ signal?: AbortSignal }>) =>
      providerProfile.checkReadiness(readinessOptions),
  });
}
