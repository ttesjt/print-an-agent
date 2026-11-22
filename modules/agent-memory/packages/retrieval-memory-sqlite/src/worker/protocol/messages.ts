import type { SqliteDatabaseConfiguration } from '../../database/index.js';
import { RetrievalMemoryError } from '@print-an-agent/retrieval-memory';
import { WORKER_OPERATION_ARITY, type WorkerOperation } from './operations.js';
import type { WorkerMessage, WorkerRequest, WorkerSuccess, WorkerResult } from './types.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function operation(value: unknown): value is WorkerOperation {
  return typeof value === 'string' && Object.hasOwn(WORKER_OPERATION_ARITY, value);
}
function invalidMessage(): never {
  throw new RetrievalMemoryError('STORAGE_FAILED', 'Invalid private SQLite worker message.');
}

// This is a private, same-build structured-clone channel. The typed producer owns payload
// validation; these assertions adapt Node's unknown message API after checking its envelope.
// They do not claim to validate domain records or accept messages from external workers.
export function readWorkerRequest(value: unknown): WorkerRequest {
  if (
    !record(value) ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    !operation(value.operation) ||
    !Array.isArray(value.args) ||
    value.args.length !== WORKER_OPERATION_ARITY[value.operation] ||
    !(value.cancellation instanceof SharedArrayBuffer) ||
    value.cancellation.byteLength !== Int32Array.BYTES_PER_ELEMENT
  )
    invalidMessage();
  const args: readonly unknown[] = value.args;
  return {
    id: value.id,
    operation: value.operation,
    args,
    cancellation: value.cancellation,
  } as WorkerRequest;
}
export function readWorkerMessage(value: unknown): WorkerMessage {
  if (!record(value)) invalidMessage();
  if (value.ready === true) return { ready: true };
  if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id)) invalidMessage();
  if ('error' in value) {
    const error = value.error;
    if (
      !record(error) ||
      typeof error.code !== 'string' ||
      typeof error.message !== 'string' ||
      (error.stack !== undefined && typeof error.stack !== 'string') ||
      !Array.isArray(error.causes) ||
      !error.causes.every(
        (cause: unknown) =>
          record(cause) &&
          typeof cause.name === 'string' &&
          typeof cause.message === 'string' &&
          (cause.stack === undefined || typeof cause.stack === 'string')
      )
    )
      invalidMessage();
  } else if (!operation(value.operation) || !('value' in value)) invalidMessage();
  return value as WorkerMessage;
}
export function isReplyFor<Operation extends WorkerOperation>(
  reply: WorkerSuccess,
  expected: Operation
): reply is WorkerSuccess & {
  readonly operation: Operation;
  readonly value: WorkerResult<Operation>;
} {
  return reply.operation === expected;
}

export function readWorkerConfiguration(value: unknown): SqliteDatabaseConfiguration {
  if (!record(value) || typeof value.path !== 'string' || typeof value.busyTimeoutMs !== 'number')
    invalidMessage();
  return { path: value.path, busyTimeoutMs: value.busyTimeoutMs };
}
