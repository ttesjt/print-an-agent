import type { MemoryStateOperations } from '../../state/types.js';
import type {
  ApplyMemoryInput,
  ConfigureMemoryInput,
  CreateMemoryInput,
} from '../../../mutations/index.js';
import type { ReadContextInput, ReadContextResult } from '../../../context/index.js';
import type { MutationResult } from '../../../types/receipt.js';

export interface MemoryOperations extends MemoryStateOperations {
  create(input: CreateMemoryInput, signal?: AbortSignal): Promise<MutationResult>;
  apply(input: ApplyMemoryInput, signal?: AbortSignal): Promise<MutationResult>;
  configure(input: ConfigureMemoryInput, signal?: AbortSignal): Promise<MutationResult>;
  readContext(input: ReadContextInput, signal?: AbortSignal): Promise<ReadContextResult>;
}

export interface MemoryWorkflowResources<
  K extends keyof MemoryOperations = keyof MemoryOperations,
> {
  readonly memory: Pick<MemoryOperations, K>;
}
