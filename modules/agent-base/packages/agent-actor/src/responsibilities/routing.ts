import { satisfiesActorRequirements, type ActorId } from '@print-an-agent/model-invocation-core';
import { MAIN_ACTOR_ID, type AgentActorCatalogPort } from '../actors/index.js';
import { AgentActorError } from '../errors.js';
import { resolveResponsibility } from './invocation.js';
import type {
  ResponsibilityId,
  ResponsibilityActorCandidate,
  ResponsibilityDefinition,
} from './types/definition.js';
import type { ResponsibilityCatalogPort } from './types/catalog.js';
import type {
  ResponsibilityRouter,
  CreateResponsibilityRouterOptions,
  ResolvedResponsibility,
} from './types/routing.js';

function effectiveCandidates(
  definition: ResponsibilityDefinition,
  mainActorId: ActorId
): readonly ResponsibilityActorCandidate[] {
  return (
    definition.actors ?? Object.freeze([Object.freeze({ actorId: mainActorId, enabled: true })])
  );
}

class DefaultResponsibilityRouter implements ResponsibilityRouter {
  readonly mainActorId: ActorId;
  readonly actorCatalog: AgentActorCatalogPort;
  readonly responsibilityCatalog: ResponsibilityCatalogPort;

  constructor(options: CreateResponsibilityRouterOptions) {
    this.mainActorId = options.mainActorId ?? MAIN_ACTOR_ID;
    this.actorCatalog = options.actorCatalog;
    this.responsibilityCatalog = options.responsibilityCatalog;
  }

  async resolve(responsibilityId: ResponsibilityId): Promise<ResolvedResponsibility> {
    await this.actorCatalog.resolve(this.mainActorId);
    const definition = await this.responsibilityCatalog.resolve(responsibilityId);
    const candidates = effectiveCandidates(definition, this.mainActorId);
    const enabled = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.enabled);
    if (enabled.length === 0) {
      throw new AgentActorError(
        'RESPONSIBILITY_UNAVAILABLE',
        `Responsibility "${responsibilityId}" has no enabled Actor candidate.`
      );
    }
    for (const { candidate, index } of enabled) {
      const actor = await this.actorCatalog.resolve(candidate.actorId);
      if (satisfiesActorRequirements(actor.capabilities, definition.requiredCapabilities)) {
        return resolveResponsibility(
          definition,
          this.responsibilityCatalog.revision,
          actor,
          index,
          candidates
        );
      }
    }
    throw new AgentActorError(
      'RESPONSIBILITY_CAPABILITY_UNAVAILABLE',
      `Responsibility "${responsibilityId}" has no compatible enabled Actor.`
    );
  }
}

export function createResponsibilityRouter(
  options: CreateResponsibilityRouterOptions
): ResponsibilityRouter {
  return new DefaultResponsibilityRouter(options);
}
