import type { SpaceInput } from '../../../types/identity.js';

export interface ListInput extends SpaceInput {
  readonly limit?: number;
  readonly cursor?: string;
}
