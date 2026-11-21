import { AgentActorError } from '../errors.js';
import { defineResponsibility } from './definition.js';
import type { ResponsibilityId, ResponsibilityDefinition } from './types/definition.js';
import type {
  ResponsibilityCatalogPort,
  CreateResponsibilityCatalogOptions,
} from './types/catalog.js';

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
