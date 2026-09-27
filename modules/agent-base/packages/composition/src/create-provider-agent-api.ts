import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@ta-agent/base-actor';
import { createPiProviderRuntime } from '@ta-agent/base-pi';
import { createAgentAPI } from './agent-api.js';
import { composeAgent } from './compose-agent.js';
import type { CreateProviderAgentAPIOptions, ProviderAgentAPI } from './types.js';

export function createProviderAgentAPI(options: CreateProviderAgentAPIOptions): ProviderAgentAPI {
  const { provider, mainActor, responsibilities, ...baseOptions } = options;
  const providerProfile = createPiProviderRuntime({
    provider: provider.config,
    ...(provider.credentialResolver === undefined
      ? {}
      : { credentialResolver: provider.credentialResolver }),
    ...(provider.actorEngineId === undefined ? {} : { actorEngineId: provider.actorEngineId }),
    ...(provider.transportLivenessPolicy === undefined
      ? {}
      : { transportLivenessPolicy: provider.transportLivenessPolicy }),
  });
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
