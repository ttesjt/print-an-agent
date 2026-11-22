import type { RetrievalBackend } from '@print-an-agent/retrieval-memory';

/** Private wire arities exclude the separately transported cancellation signal. */
export const WORKER_OPERATION_ARITY = {
  inspect: 1,
  get: 2,
  getReceipt: 2,
  publish: 1,
  list: 1,
  search: 1,
  close: 0,
} as const satisfies Record<keyof RetrievalBackend | 'close', number>;
export type WorkerOperation = keyof typeof WORKER_OPERATION_ARITY;
