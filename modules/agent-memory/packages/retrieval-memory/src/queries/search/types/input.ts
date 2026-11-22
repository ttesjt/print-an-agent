import type { MetadataFilter } from '../../../filters/index.js';
import type { SpaceInput } from '../../../types/identity.js';

export interface SearchInput extends SpaceInput {
  readonly query: string;
  readonly filter?: MetadataFilter;
  readonly topK?: number;
}
