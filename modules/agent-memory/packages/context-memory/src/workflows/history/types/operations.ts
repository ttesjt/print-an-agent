import type { MemorySnapshot } from '../../../types/document.js';
import type {
  ForkMemoryInput,
  ListMemoryVersionsInput,
  MemoryHistoryPage,
  MemoryVersionReference,
} from '../../../history/index.js';
import type { MutationResult } from '../../../types/receipt.js';
import type { MemoryOperations } from '../../deterministic/types/resources.js';

export interface MemoryHistoryOperations extends Pick<MemoryOperations, 'getReceipt'> {
  inspectVersion(input: MemoryVersionReference, signal?: AbortSignal): Promise<MemorySnapshot>;
  listVersions(input: ListMemoryVersionsInput, signal?: AbortSignal): Promise<MemoryHistoryPage>;
  fork(input: ForkMemoryInput, signal?: AbortSignal): Promise<MutationResult>;
}

export interface MemoryHistoryWorkflowResources {
  readonly memory: MemoryHistoryOperations;
}
