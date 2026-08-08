import {
  BUILT_IN_RESPONSIBILITIES,
  AgentActorError,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@ta-agent/base-actor';
import { createPiFauxRuntime } from '@ta-agent/base-pi';
import { assembleAgentBase } from './assemble-agent-base.js';
import type { CreatePiFauxAgentBaseOptions, PiFauxAgentBase } from './types.js';

export function createPiFauxAgentBase(options: CreatePiFauxAgentBaseOptions): PiFauxAgentBase {
  const {
    pi,
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
      'Pi faux composition requires Actor and Responsibility catalogs to be injected together.'
    );
  }
  if (
    injectedActorCatalog !== undefined &&
    (mainActor !== undefined || responsibilities !== undefined)
  ) {
    throw new AgentActorError(
      'ACTOR_CATALOG_INVALID',
      'Injected catalogs cannot be combined with Pi faux Actor definition shortcuts.'
    );
  }
  if (
    injectedActorCatalog === undefined &&
    mainActorId !== undefined &&
    mainActorId !== MAIN_ACTOR_ID
  ) {
    throw new AgentActorError(
      'ACTOR_CATALOG_INVALID',
      'The Pi faux shortcut catalog always names its required Actor "main".'
    );
  }
  const piProfile = createPiFauxRuntime(pi);
  const actorCatalog =
    injectedActorCatalog ??
    createActorCatalog({
      actors: [
        {
          ...mainActor,
          id: MAIN_ACTOR_ID,
          engineId: piProfile.actorEngine.id,
        },
      ],
      engines: [piProfile.actorEngine],
    });
  const responsibilityCatalog =
    injectedResponsibilityCatalog ??
    createResponsibilityCatalog({
      responsibilities: responsibilities ?? BUILT_IN_RESPONSIBILITIES,
    });
  const assembled = assembleAgentBase({
    ...baseOptions,
    actorCatalog,
    responsibilityCatalog,
    ...(mainActorId === undefined ? {} : { mainActorId }),
  });
  return Object.freeze({ ...assembled, inspectPi: () => piProfile.inspect() });
}
