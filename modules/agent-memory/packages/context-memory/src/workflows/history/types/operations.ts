import type { MemorySnapshot } from '../../../types/document.js';
import type {
  ForkMemoryInput,
  ListMemoryVersionsInput,
  MemoryHistoryPage,
  MemoryVersionReference,
} from '../../../history/index.js';
import type { MutationResult } from '../../../types/receipt.js';
import type { MemoryStateOperations } from '../../state/index.js';

export interface MemoryHistoryOperations extends Pick<MemoryStateOperations, 'getReceipt'> {
  inspectVersion(input: MemoryVersionReference, signal?: AbortSignal): Promise<MemorySnapshot>;
  listVersions(input: ListMemoryVersionsInput, signal?: AbortSignal): Promise<MemoryHistoryPage>;
  fork(input: ForkMemoryInput, signal?: AbortSignal): Promise<MutationResult>;
}

export interface MemoryHistoryWorkflowResources {
  readonly memory: MemoryHistoryOperations;
}
