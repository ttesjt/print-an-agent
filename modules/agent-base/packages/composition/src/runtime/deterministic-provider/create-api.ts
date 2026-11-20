import {
  AgentActorError,
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@print-an-agent/base-actor';
import { createPiFauxRuntime } from '@print-an-agent/model-invocation-pi';
import { createAgentAPI } from '../agent-api.js';
import { composeAgent } from '../standard-agent/index.js';
import type { CreateDeterministicAgentAPIOptions, DeterministicAgentAPI } from './types/api.js';

export function createDeterministicAgentAPI(
  options: CreateDeterministicAgentAPIOptions
): DeterministicAgentAPI {
  const {
    provider,
    actorCatalog: injectedActorCatalog,
    responsibilityCatalog: injectedResponsibilityCatalog,
    mainActorId,
    mainActor,
    responsibilities,
    ...baseOptions
  } = options;
  if ((injectedActorCatalog === undefined) !== (injectedResponsibilityCatalog === undefined)) {
    throw new AgentActorError(
      'ACTOR_CATALOG_INVALID',
      'Deterministic composition requires Actor and Responsibility catalogs to be injected together.'
    );
  }
  if (
    injectedActorCatalog !== undefined &&
    (mainActor !== undefined || responsibilities !== undefined)
  ) {
    throw new AgentActorError(
      'ACTOR_CATALOG_INVALID',
      'Injected catalogs cannot be combined with deterministic Actor definition shortcuts.'
    );
  }
  if (
    injectedActorCatalog === undefined &&
    mainActorId !== undefined &&
    mainActorId !== MAIN_ACTOR_ID
  ) {
    throw new AgentActorError(
      'ACTOR_CATALOG_INVALID',
      'The deterministic shortcut catalog always names its required Actor "main".'
    );
  }
  const providerProfile = createPiFauxRuntime(provider);
  const actorCatalog =
    injectedActorCatalog ??
    createActorCatalog({
      actors: [
        {
          ...mainActor,
          id: MAIN_ACTOR_ID,
          engineId: providerProfile.actorEngine.id,
        },
      ],
      engines: [providerProfile.actorEngine],
    });
  const responsibilityCatalog =
    injectedResponsibilityCatalog ??
    createResponsibilityCatalog({
      responsibilities: responsibilities ?? BUILT_IN_RESPONSIBILITIES,
    });
  const agent = composeAgent({
    ...baseOptions,
    actorCatalog,
    responsibilityCatalog,
    ...(mainActorId === undefined ? {} : { mainActorId }),
  });
  return Object.freeze({
    ...createAgentAPI(agent),
    inspectDeterministicProvider: () => providerProfile.inspect(),
  });
}
