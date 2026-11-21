import type { ActorId, ActorEngineInput } from '@print-an-agent/model-invocation-core';
import type {
  AgentActorDefinition,
  AgentActorDefinitionInput,
  ResolvedAgentActor,
} from './definition.js';

export interface AgentActorCatalogPort {
  readonly revision: number;
  resolve(actorId: ActorId): Promise<ResolvedAgentActor>;
  list(): readonly AgentActorDefinition[];
}
export interface CreateAgentActorCatalogOptions {
  readonly revision?: number;
  readonly actors: readonly AgentActorDefinitionInput[];
  readonly engines: readonly ActorEngineInput[];
}
