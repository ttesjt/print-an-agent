import type { MemoryOperations } from './resources.js';
import type { MemoryOperationDefinition, MemoryOperationOptions } from '../../shared/index.js';

export type MemoryDefinition<
  I,
  O,
  K extends keyof Operations,
  Operations extends object = MemoryOperations,
> = MemoryOperationDefinition<I, O, K, Operations>;

export type MemoryWorkflowOptions<
  I,
  O,
  K extends keyof Operations,
  Operations extends object = MemoryOperations,
> = MemoryOperationOptions<I, O, K, Operations>;
