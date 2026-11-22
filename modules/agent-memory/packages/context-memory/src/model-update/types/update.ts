import type { MutationResult } from '../../types/receipt.js';
import type { ModelMemoryInput, ModelMemoryOperation } from './input.js';
import type { MemoryUpdate } from '../candidate.js';

export interface MemoryUpdatePort {
  begin(
    operation: ModelMemoryOperation,
    input: ModelMemoryInput,
    signal: AbortSignal
  ): Promise<
    { status: 'replayed'; result: MutationResult } | { status: 'candidate'; update: MemoryUpdate }
  >;
}
