import type {
  ActorId,
  ModelInteractionResult,
  ActorDirectRequest,
  ActorDirectResult,
  ActorInteractionRequest,
  ActorStreamingRequest,
} from '@print-an-agent/model-invocation-core';
import type { ToolName } from '@print-an-agent/base-tool';
import type { ResolvedAgentActor, AgentActorCatalogPort } from '../../actors/index.js';
import type { ResponsibilityId, ResponsibilityActorCandidate } from './definition.js';
import type { ResponsibilityCatalogPort } from './catalog.js';

export interface ResolvedResponsibility {
  readonly id: ResponsibilityId;
  readonly catalogRevision: number;
  readonly actor: ResolvedAgentActor;
  readonly candidateIndex: number;
  readonly allowedTools: readonly ToolName[];
  readonly effectiveCandidates: readonly ResponsibilityActorCandidate[];
  interact(request: ActorInteractionRequest): Promise<ModelInteractionResult>;
  complete(request: ActorDirectRequest): Promise<ActorDirectResult>;
  stream?(request: ActorStreamingRequest): Promise<ActorDirectResult>;
}

export interface ResponsibilityRouter {
  readonly mainActorId: ActorId;
  readonly actorCatalog: AgentActorCatalogPort;
  readonly responsibilityCatalog: ResponsibilityCatalogPort;
  resolve(responsibilityId: ResponsibilityId): Promise<ResolvedResponsibility>;
}

export interface CreateResponsibilityRouterOptions {
  readonly actorCatalog: AgentActorCatalogPort;
  readonly responsibilityCatalog: ResponsibilityCatalogPort;
  readonly mainActorId?: ActorId;
}
