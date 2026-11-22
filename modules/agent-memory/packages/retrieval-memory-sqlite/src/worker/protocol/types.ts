import type {
  RetrievalBackend,
  CommitEvidence,
  RetrievalErrorCode,
} from '@print-an-agent/retrieval-memory';
import type { WorkerOperation } from './operations.js';

type WithoutSignal<Args extends readonly unknown[]> =
  Required<Args> extends [...infer Input, AbortSignal] ? readonly [...Input] : never;
export type WorkerArguments<Operation extends WorkerOperation> =
  Operation extends keyof RetrievalBackend
    ? WithoutSignal<Parameters<RetrievalBackend[Operation]>>
    : readonly [];
export type WorkerResult<Operation extends WorkerOperation> =
  Operation extends keyof RetrievalBackend
    ? Awaited<ReturnType<RetrievalBackend[Operation]>>
    : void;
export interface WorkerCall<Operation extends WorkerOperation> {
  readonly id: number;
  readonly operation: Operation;
  readonly args: WorkerArguments<Operation>;
  readonly cancellation: SharedArrayBuffer;
}
export type WorkerRequest = {
  [Operation in WorkerOperation]: WorkerCall<Operation>;
}[WorkerOperation];
export type WorkerSuccess<Operation extends WorkerOperation = WorkerOperation> = {
  [Key in Operation]: {
    readonly id: number;
    readonly operation: Key;
    readonly value: WorkerResult<Key>;
  };
}[Operation];
export interface WorkerFailure {
  readonly id: number;
  readonly error: {
    readonly code: RetrievalErrorCode;
    readonly message: string;
    readonly stack?: string;
    readonly commit?: CommitEvidence;
    readonly causes: readonly FailureDetail[];
  };
}
export type WorkerReply = WorkerSuccess | WorkerFailure;
export type WorkerMessage = WorkerReply | { readonly ready: true };
export interface FailureDetail {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}
