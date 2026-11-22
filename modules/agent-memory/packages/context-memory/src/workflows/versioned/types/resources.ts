import type { ReadMemoryVersionContextInput } from '../../../history/index.js';
import type { ReadContextResult } from '../../../context/index.js';
import type { MemoryOperations } from '../../deterministic/types/resources.js';
import type { MemoryHistoryOperations } from '../../history/types/operations.js';

export interface VersionedMemoryOperations extends MemoryOperations, MemoryHistoryOperations {
  readVersionContext(
    input: ReadMemoryVersionContextInput,
    signal?: AbortSignal
  ): Promise<ReadContextResult>;
}

export interface VersionedMemoryWorkflowResources {
  readonly memory: VersionedMemoryOperations;
}
