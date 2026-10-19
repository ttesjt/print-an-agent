import type { JsonObject, ModelEditOperation } from './document.js';
import type { CompactionTarget } from './inputs.js';

export interface MemoryExperience {
  readonly role: string;
  readonly content: string;
  readonly source?: JsonObject;
}
export interface ObserveMemoryInput {
  readonly memoryId: string;
  readonly requestId: string;
  readonly context: readonly MemoryExperience[];
}
export interface EditMemoryInput {
  readonly memoryId: string;
  readonly requestId: string;
  readonly instruction: string;
  readonly context?: readonly MemoryExperience[];
}
export interface CompactMemoryInput {
  readonly memoryId: string;
  readonly requestId: string;
  readonly target?: CompactionTarget;
}
export type ModelMemoryOperation = 'observe' | 'edit' | 'compact';
export type ModelMemoryInput = ObserveMemoryInput | EditMemoryInput | CompactMemoryInput;
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
