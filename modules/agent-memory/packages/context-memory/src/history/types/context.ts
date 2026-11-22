import type { ReadContextInput } from '../../context/index.js';

export interface ReadMemoryVersionContextInput extends ReadContextInput {
  readonly revision: number;
}
