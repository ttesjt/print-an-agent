import type { ModelEditOperation } from './operations.js';
import type { MemoryExperience, ModelMemoryOperation } from './input.js';

export interface MemoryPlannerRequest {
  readonly task: ModelMemoryOperation;
  readonly source: readonly { readonly id: string; readonly content: string }[];
  readonly items: readonly { readonly id: string; readonly content: string }[];
  readonly context: readonly MemoryExperience[];
  readonly instruction?: string;
  /** A soft content goal, never the authority for acceptance. No renderer/count metadata. */
  readonly targetTokens?: number;
}

export interface MemoryPlanner {
  plan(request: MemoryPlannerRequest, signal: AbortSignal): Promise<readonly ModelEditOperation[]>;
}
