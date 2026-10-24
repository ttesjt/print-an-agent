import type { CommitEvidence, RetrievalErrorCode } from '@ta-agent/retrieval-memory';
export type WorkerOperation =
  | 'inspect'
  | 'get'
  | 'getReceipt'
  | 'publish'
  | 'list'
  | 'search'
  | 'close';
export interface WorkerRequest {
  readonly id: number;
  readonly operation: WorkerOperation;
  readonly args: readonly unknown[];
  readonly cancellation: SharedArrayBuffer;
}
export type WorkerReply =
  | { readonly id: number; readonly value: unknown }
  | {
      readonly id: number;
      readonly error: {
        readonly code: RetrievalErrorCode;
        readonly message: string;
        readonly commit?: CommitEvidence;
        readonly causes: readonly FailureDetail[];
      };
    };
export interface WorkerConfiguration {
  readonly path: string;
  readonly busyTimeoutMs: number;
}
export interface FailureDetail {
  readonly name: string;
  readonly message: string;
}
