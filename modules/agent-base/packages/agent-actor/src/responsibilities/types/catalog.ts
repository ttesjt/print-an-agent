import type {
  ResponsibilityId,
  ResponsibilityDefinition,
  ResponsibilityDefinitionInput,
} from './definition.js';

export interface ResponsibilityCatalogPort {
  readonly revision: number;
  resolve(responsibilityId: ResponsibilityId): Promise<ResponsibilityDefinition>;
  list(): readonly ResponsibilityDefinition[];
}

export interface CreateResponsibilityCatalogOptions {
  readonly revision?: number;
  readonly responsibilities: readonly ResponsibilityDefinitionInput[];
}
