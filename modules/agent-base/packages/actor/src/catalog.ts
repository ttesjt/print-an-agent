import {
  createActorCatalog as createModelActorCatalog,
  type ActorId,
  type ActorEngineInput,
} from '@print-an-agent/model-invocation-core';
import {
  defineAgentActor,
  type ActorDefinition,
  type ActorDefinitionInput,
  type ResolvedActor,
} from './actor.js';

export interface ActorCatalogPort {
  readonly revision: number;
  resolve(actorId: ActorId): Promise<ResolvedActor>;
  list(): readonly ActorDefinition[];
}
export interface CreateActorCatalogOptions {
  readonly revision?: number;
  readonly actors: readonly ActorDefinitionInput[];
  readonly engines: readonly ActorEngineInput[];
}

export function createActorCatalog(options: CreateActorCatalogOptions): ActorCatalogPort {
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
    async resolve(actorId: ActorId): Promise<ResolvedActor> {
      const actor = await catalog.resolve(actorId);
      return Object.freeze({
        ...actor,
        catalogRevision: catalog.revision,
        allowedTools: definitions.get(actorId)?.allowedTools ?? Object.freeze([]),
      });
    },
  });
}
