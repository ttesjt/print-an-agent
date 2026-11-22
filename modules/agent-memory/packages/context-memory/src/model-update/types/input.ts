import type { JsonObject } from '../../types/json.js';
import type { CompactionTarget } from '../../budget/index.js';

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
