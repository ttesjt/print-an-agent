import type { SqliteDatabaseConfiguration } from '../database/index.js';
import { Worker } from 'node:worker_threads';
import { assertNotAborted, RetrievalMemoryError } from '@print-an-agent/retrieval-memory';
import {
  restoreFailures,
  readWorkerMessage,
  isReplyFor,
  type WorkerOperation,
  type WorkerArguments,
  type WorkerResult,
  type WorkerCall,
  type WorkerSuccess,
  type WorkerMessage,
} from './protocol/index.js';
import type { WorkerClient } from './types.js';

interface Pending {
  readonly resolve: (reply: WorkerSuccess) => void;
  readonly reject: (error: unknown) => void;
  readonly dispose: () => void;
}

export async function createWorkerClient(
  configuration: SqliteDatabaseConfiguration
): Promise<WorkerClient> {
  const worker = new Worker(new URL('./worker-entry.js', import.meta.url), {
    workerData: configuration,
  });
  const exited = new Promise<void>((resolve, reject) =>
    worker.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('SQLite worker exited abnormally.'))
    )
  );
  void exited.catch(() => undefined);
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let closing = false;
  let hasExited = false;
  let failure: Error | undefined;
  let closeResult: Promise<void> | undefined;
  let closeDispatched = false;
  let readyResolve: () => void;
  let readyReject: (cause: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const failAll = (cause: Error) => {
    failure = cause;
    readyReject(cause);
    for (const item of pending.values()) {
      item.dispose();
      item.reject(cause);
    }
    pending.clear();
  };
  worker.on('error', failAll);
  worker.on('exit', (code) => {
    hasExited = true;
    if (!closing || pending.size > 0 || code !== 0)
      failAll(
        new RetrievalMemoryError('STORAGE_FAILED', 'SQLite worker exited before its work drained.')
      );
  });
  worker.on('message', (message: unknown) => {
    let reply: WorkerMessage;
    try {
      reply = readWorkerMessage(message);
    } catch (cause) {
      failAll(cause instanceof Error ? cause : new Error('Invalid SQLite reply.', { cause }));
      return;
    }
    if ('ready' in reply) {
      readyResolve();
      return;
    }
    const item = pending.get(reply.id);
    if (item === undefined) return;
    pending.delete(reply.id);
    item.dispose();
    if ('error' in reply) {
      const error = new RetrievalMemoryError(reply.error.code, reply.error.message, {
        cause: restoreFailures(reply.error.causes),
        ...(reply.error.commit === undefined ? {} : { commit: reply.error.commit }),
      });
      if (reply.error.stack !== undefined) error.stack = reply.error.stack;
      item.reject(error);
    } else item.resolve(reply);
  });
  async function call<Operation extends WorkerOperation>(
    operation: Operation,
    args: WorkerArguments<Operation>,
    signal?: AbortSignal
  ): Promise<WorkerResult<Operation>> {
    assertNotAborted(signal);
    if (failure !== undefined && operation !== 'close') throw failure;
    if (closing && operation !== 'close')
      throw new RetrievalMemoryError('STORAGE_FAILED', 'SQLite backend is closing.');
    const cancellation = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const flag = new Int32Array(cancellation);
    const abort = () => Atomics.store(flag, 0, 1);
    signal?.addEventListener('abort', abort, { once: true });
    return new Promise<WorkerResult<Operation>>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, {
        resolve: (reply) => {
          if (isReplyFor(reply, operation)) resolve(reply.value);
          else
            reject(new RetrievalMemoryError('STORAGE_FAILED', 'SQLite reply operation mismatch.'));
        },
        reject,
        dispose: () => signal?.removeEventListener('abort', abort),
      });
      try {
        const request: WorkerCall<Operation> = { id, operation, args, cancellation };
        worker.postMessage(request);
        if (operation === 'close') closeDispatched = true;
      } catch (cause) {
        pending.delete(id);
        signal?.removeEventListener('abort', abort);
        reject(
          new RetrievalMemoryError('STORAGE_FAILED', 'SQLite request could not be dispatched.', {
            cause,
          })
        );
      }
    });
  }
  try {
    await ready;
  } catch (cause) {
    await worker.terminate();
    throw new RetrievalMemoryError('STORAGE_FAILED', 'SQLite backend initialization failed.', {
      cause,
    });
  }
  return {
    call,
    close(): Promise<void> {
      if (closeResult !== undefined) return closeResult;
      closing = true;
      // FIFO dispatch guarantees close follows every admitted synchronous operation, without termination.
      const drain = hasExited
        ? failure === undefined
          ? Promise.resolve()
          : Promise.reject(failure)
        : call('close', []);
      closeResult = drain
        .then(async () => {
          await exited;
          if (failure !== undefined) throw failure;
        })
        .catch(async (cause: unknown) => {
          let diagnostic = cause;
          // A failed dispatch never asks the live Worker to exit. Waiting then would hang.
          if (closeDispatched || hasExited) {
            try {
              await exited;
            } catch (exitCause) {
              if (exitCause !== cause)
                diagnostic = new AggregateError(
                  [cause, exitCause],
                  'SQLite close and worker exit failed.'
                );
            }
          }
          throw new RetrievalMemoryError(
            'CLEANUP_FAILED',
            'SQLite backend could not close cleanly.',
            { cause: diagnostic }
          );
        });
      return closeResult;
    },
  };
}
