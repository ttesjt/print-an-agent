import type { MutationOperation } from '../../mutation-operations.js';
import type { MutationResult } from '../../types/publication.js';
import type { PreparedMutation } from '../../persistence/index.js';

export interface RetrievalMutationOperations<K extends MutationOperation = MutationOperation> {
  prepare(operation: K, value: unknown, signal: AbortSignal): Promise<PreparedMutation>;
  publish(prepared: PreparedMutation, signal: AbortSignal): Promise<MutationResult>;
  run(operation: K, input: unknown, signal?: AbortSignal): Promise<MutationResult>;
}
