import {
  BUILT_IN_RESPONSIBILITIES,
  createActorCatalog,
  createResponsibilityCatalog,
  MAIN_ACTOR_ID,
} from '@ta-agent/base-actor';
import { createPiProviderRuntime } from '@ta-agent/base-pi';
import { assembleAgentBase } from './assemble-agent-base.js';
import type { CreatePiAgentBaseOptions, PiAgentBase } from './types.js';

export function createPiAgentBase(options: CreatePiAgentBaseOptions): PiAgentBase {
  const { pi, mainActor, responsibilities, ...baseOptions } = options;
  const piProfile = createPiProviderRuntime(pi);
  const actorCatalog = createActorCatalog({
    actors: [
      {
        ...mainActor,
        id: MAIN_ACTOR_ID,
        engineId: piProfile.actorEngine.id,
      },
    ],
    engines: [piProfile.actorEngine],
  });
  const responsibilityCatalog = createResponsibilityCatalog({
    responsibilities: responsibilities ?? BUILT_IN_RESPONSIBILITIES,
  });
  const assembled = assembleAgentBase({
    ...baseOptions,
    actorCatalog,
    responsibilityCatalog,
  });

  return Object.freeze({
    ...assembled,
    inspectPiProvider: () => piProfile.inspect(),
    checkPiProviderReadiness: (readinessOptions?: Readonly<{ signal?: AbortSignal }>) =>
      piProfile.checkReadiness(readinessOptions),
  });
}
