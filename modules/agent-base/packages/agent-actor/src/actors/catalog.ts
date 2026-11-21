import {
  createActorCatalog as createModelActorCatalog,
  type ActorId,
} from '@print-an-agent/model-invocation-core';
import { defineAgentActor } from './definition.js';
import type { AgentActorCatalogPort, CreateAgentActorCatalogOptions } from './types/catalog.js';
import type { ResolvedAgentActor } from './types/definition.js';

export function createAgentActorCatalog(
  options: CreateAgentActorCatalogOptions
): AgentActorCatalogPort {
  const actors = options.actors.map(defineAgentActor);
  const definitions = new Map(actors.map((actor) => [actor.id, actor]));
  const catalog = createModelActorCatalog({
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    engines: options.engines,
    actors: actors.map(({ allowedTools: _permissions, ...actor }) => actor),
  });
  return Object.freeze({
    revision: catalog.revision,
    list: () => Object.freeze([...definitions.values()]),
    async resolve(actorId: ActorId): Promise<ResolvedAgentActor> {
      const actor = await catalog.resolve(actorId);
      return Object.freeze({
        ...actor,
        catalogRevision: catalog.revision,
        allowedTools: definitions.get(actorId)?.allowedTools ?? Object.freeze([]),
      });
    },
  });
}
