import {
  BUILT_IN_RESPONSIBILITIES,
  createAgentActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@print-an-agent/agent-actor';
import { createAgentAPI } from '../agent-api.js';
import { composeAgent } from '../standard-agent/index.js';
import { createProviderRuntime } from './create-runtime.js';
import type { CreateProviderAgentAPIOptions, ProviderAgentAPI } from './types/api.js';

export function createProviderAgentAPI(options: CreateProviderAgentAPIOptions): ProviderAgentAPI {
  const { provider, mainActor, responsibilities, ...baseOptions } = options;
  const providerProfile = createProviderRuntime(provider);
  const actorCatalog = createAgentActorCatalog({
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
