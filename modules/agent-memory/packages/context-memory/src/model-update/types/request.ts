import type { CompactionTarget } from '../../budget/index.js';
import type { MemoryExperience } from './input.js';
import type { MutationRequest } from '../../types/receipt.js';

export interface ModelMemoryRequest {
  readonly request: MutationRequest;
  readonly context: readonly MemoryExperience[];
  readonly instruction?: string;
  readonly target?: CompactionTarget;
}
