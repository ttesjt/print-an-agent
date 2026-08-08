import { satisfiesActorRequirements } from './capabilities.js';
import type { ActorCatalogPort } from './catalog.js';
import { AgentActorError } from './errors.js';
import { MAIN_ACTOR_ID, type ActorId, type ResponsibilityId } from './identifiers.js';
import {
  defineResponsibility,
  resolveResponsibility,
  type ResolvedResponsibility,
  type ResponsibilityActorCandidate,
  type ResponsibilityDefinition,
  type ResponsibilityDefinitionInput,
} from './responsibility.js';

export interface ResponsibilityCatalogPort {
  readonly revision: number;
  resolve(responsibilityId: ResponsibilityId): Promise<ResponsibilityDefinition>;
  list(): readonly ResponsibilityDefinition[];
}

export interface CreateResponsibilityCatalogOptions {
  readonly revision?: number;
  readonly responsibilities: readonly ResponsibilityDefinitionInput[];
}

export interface ResponsibilityRouter {
  readonly mainActorId: ActorId;
  readonly actorCatalog: ActorCatalogPort;
  readonly responsibilityCatalog: ResponsibilityCatalogPort;
  resolve(responsibilityId: ResponsibilityId): Promise<ResolvedResponsibility>;
}

export interface CreateResponsibilityRouterOptions {
  readonly actorCatalog: ActorCatalogPort;
  readonly responsibilityCatalog: ResponsibilityCatalogPort;
  readonly mainActorId?: ActorId;
}

function parseRevision(value: number | undefined): number {
  const revision = value ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new AgentActorError(
      'RESPONSIBILITY_CATALOG_INVALID',
      'Responsibility catalog revision must be a positive safe integer.'
    );
  }
  return revision;
}

function cloneResponsibility(definition: ResponsibilityDefinition): ResponsibilityDefinition {
  return Object.freeze({
    ...definition,
    ...(definition.actors === undefined
      ? {}
      : {
          actors: Object.freeze(
            definition.actors.map((candidate) => Object.freeze({ ...candidate }))
          ),
        }),
    requiredCapabilities: Object.freeze({
      ...definition.requiredCapabilities,
      ...(definition.requiredCapabilities.inputMediaTypes === undefined
        ? {}
        : {
            inputMediaTypes: Object.freeze([...definition.requiredCapabilities.inputMediaTypes]),
          }),
    }),
    allowedTools: Object.freeze([...definition.allowedTools]),
  });
}

class ImmutableResponsibilityCatalog implements ResponsibilityCatalogPort {
  readonly revision: number;
  readonly #definitions: ReadonlyMap<ResponsibilityId, ResponsibilityDefinition>;

  constructor(options: CreateResponsibilityCatalogOptions) {
    this.revision = parseRevision(options.revision);
    const definitions = new Map<ResponsibilityId, ResponsibilityDefinition>();
    for (const input of options.responsibilities) {
      const definition = defineResponsibility(input);
      if (definitions.has(definition.id)) {
        throw new AgentActorError(
          'RESPONSIBILITY_CATALOG_INVALID',
          `Responsibility catalog contains duplicate ID "${definition.id}".`
        );
      }
      definitions.set(definition.id, definition);
    }
    this.#definitions = definitions;
  }

  resolve(responsibilityId: ResponsibilityId): Promise<ResponsibilityDefinition> {
    return Promise.resolve().then(() => {
      const definition = this.#definitions.get(responsibilityId);
      if (definition === undefined) {
        throw new AgentActorError(
          'RESPONSIBILITY_NOT_FOUND',
          `Responsibility "${responsibilityId}" is not registered.`
        );
      }
      return cloneResponsibility(definition);
    });
  }

  list(): readonly ResponsibilityDefinition[] {
    return Object.freeze([...this.#definitions.values()].map(cloneResponsibility));
  }
}

export function createResponsibilityCatalog(
  options: CreateResponsibilityCatalogOptions
): ResponsibilityCatalogPort {
  return new ImmutableResponsibilityCatalog(options);
}

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
  readonly actorCatalog: ActorCatalogPort;
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
