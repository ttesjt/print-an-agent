import type { ActorId } from '../identifiers.js';
import type { ActorDefinition, ActorDefinitionInput, ResolvedActor } from './definition.js';
import type { ActorEngineInput } from './engine.js';

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
