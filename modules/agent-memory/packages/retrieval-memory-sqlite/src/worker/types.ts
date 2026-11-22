import type { WorkerOperation, WorkerArguments, WorkerResult } from './protocol/index.js';

export interface WorkerClient {
  call<Operation extends WorkerOperation>(
    operation: Operation,
    args: WorkerArguments<Operation>,
    signal?: AbortSignal
  ): Promise<WorkerResult<Operation>>;
  close(): Promise<void>;
}
