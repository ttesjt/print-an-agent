import {
  defineActor,
  resolveActor,
  type ActorDefinition,
  type ActorDefinitionInput,
  type ResolvedActor,
} from './actor.js';
import { defineActorEngine, type ActorEngine, type ActorEngineInput } from './engine.js';
import { AgentActorError } from './errors.js';
import type { ActorId } from './identifiers.js';

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

function parseCatalogRevision(value: number | undefined, label: string): number {
  const revision = value ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new AgentActorError(
      'ACTOR_CATALOG_INVALID',
      `${label} revision must be a positive safe integer.`
    );
  }
  return revision;
}

function cloneActorDefinition(definition: ActorDefinition): ActorDefinition {
  return Object.freeze({
    ...definition,
    invocationConfig: Object.freeze({ ...definition.invocationConfig }),
    ...(definition.capabilityLimits === undefined
      ? {}
      : {
          capabilityLimits: Object.freeze({
            ...definition.capabilityLimits,
            ...(definition.capabilityLimits.invocationModes === undefined
              ? {}
              : {
                  invocationModes: Object.freeze([...definition.capabilityLimits.invocationModes]),
                }),
            ...(definition.capabilityLimits.inputMediaTypes === undefined
              ? {}
              : {
                  inputMediaTypes: Object.freeze([...definition.capabilityLimits.inputMediaTypes]),
                }),
          }),
        }),
    allowedTools: Object.freeze([...definition.allowedTools]),
  });
}

class ImmutableActorCatalog implements ActorCatalogPort {
  readonly revision: number;
  readonly #actors: ReadonlyMap<ActorId, ActorDefinition>;
  readonly #engines: ReadonlyMap<ActorEngine['id'], ActorEngine>;

  constructor(options: CreateActorCatalogOptions) {
    this.revision = parseCatalogRevision(options.revision, 'Actor catalog');
    const engines = options.engines.map(defineActorEngine);
    const engineMap = new Map<ActorEngine['id'], ActorEngine>();
    for (const engine of engines) {
      if (engineMap.has(engine.id)) {
        throw new AgentActorError(
          'ACTOR_CATALOG_INVALID',
          `Actor catalog contains duplicate Engine "${engine.id}".`
        );
      }
      engineMap.set(engine.id, engine);
    }
    const actorMap = new Map<ActorId, ActorDefinition>();
    for (const input of options.actors) {
      const actor = defineActor(input);
      if (actorMap.has(actor.id)) {
        throw new AgentActorError(
          'ACTOR_CATALOG_INVALID',
          `Actor catalog contains duplicate Actor "${actor.id}".`
        );
      }
      const engine = engineMap.get(actor.engineId);
      if (engine === undefined) {
        throw new AgentActorError(
          'ACTOR_ENGINE_NOT_FOUND',
          `Actor "${actor.id}" references unavailable Engine "${actor.engineId}".`
        );
      }
      resolveActor(actor, engine, this.revision);
      actorMap.set(actor.id, actor);
    }
    this.#actors = actorMap;
    this.#engines = engineMap;
  }

  resolve(actorId: ActorId): Promise<ResolvedActor> {
    return Promise.resolve().then(() => {
      const definition = this.#actors.get(actorId);
      if (definition === undefined) {
        throw new AgentActorError('ACTOR_NOT_FOUND', `Actor "${actorId}" is not registered.`);
      }
      const engine = this.#engines.get(definition.engineId);
      if (engine === undefined) {
        throw new AgentActorError(
          'ACTOR_ENGINE_NOT_FOUND',
          `Actor "${actorId}" references unavailable Engine "${definition.engineId}".`
        );
      }
      return resolveActor(definition, engine, this.revision);
    });
  }

  list(): readonly ActorDefinition[] {
    return Object.freeze([...this.#actors.values()].map(cloneActorDefinition));
  }
}

export function createActorCatalog(options: CreateActorCatalogOptions): ActorCatalogPort {
  return new ImmutableActorCatalog(options);
}

export { parseCatalogRevision };
