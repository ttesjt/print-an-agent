import type { CompletionCapability } from '@print-an-agent/model-invocation-core';
import type { ModelMemoryOperation } from '../types/input.js';

export interface CompletionMemoryPlannerOptions {
  readonly completion: CompletionCapability;
  readonly instructions?: Partial<Readonly<Record<ModelMemoryOperation, string>>>;
  readonly maxOutputCharacters?: number;
}
