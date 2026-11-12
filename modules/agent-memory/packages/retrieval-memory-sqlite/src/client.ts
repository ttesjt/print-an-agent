import { Worker } from 'node:worker_threads';
import { assertNotAborted, RetrievalMemoryError } from '@print-an-agent/retrieval-memory';
import type { WorkerConfiguration, WorkerOperation, WorkerReply } from './protocol.js';
import { restoreFailures } from './failures.js';
interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly dispose: () => void;
  readonly operation: WorkerOperation;
}
export async function createWorkerClient(configuration: WorkerConfiguration) {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: configuration });
  const exited = new Promise<void>((resolve, reject) =>
    worker.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('SQLite worker exited abnormally.'))
    )
  );
  void exited.catch(() => undefined);
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let closing = false;
  let failure: Error | undefined;
  let closeResult: Promise<void> | undefined;
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
    if (!closing || pending.size > 0 || code !== 0)
      failAll(
        new RetrievalMemoryError('STORAGE_FAILED', 'SQLite worker exited before its work drained.')
      );
  });
  worker.on('message', (reply: WorkerReply | { ready: true }) => {
    if ('ready' in reply) {
      readyResolve();
      return;
    }
    const item = pending.get(reply.id);
    if (item === undefined) return;
    pending.delete(reply.id);
    item.dispose();
    if ('error' in reply)
      item.reject(
        new RetrievalMemoryError(reply.error.code, reply.error.message, {
          cause: restoreFailures(reply.error.causes),
          ...(reply.error.commit === undefined ? {} : { commit: reply.error.commit }),
        })
      );
    else item.resolve(reply.value);
  });
  async function call(
    operation: WorkerOperation,
    args: readonly unknown[],
    signal?: AbortSignal
  ): Promise<unknown> {
    assertNotAborted(signal);
    if (failure !== undefined) throw failure;
    if (closing && operation !== 'close')
      throw new RetrievalMemoryError('STORAGE_FAILED', 'SQLite backend is closing.');
    const cancellation = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const flag = new Int32Array(cancellation);
    const abort = () => Atomics.store(flag, 0, 1);
    signal?.addEventListener('abort', abort, { once: true });
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, {
        resolve,
        reject,
        dispose: () => signal?.removeEventListener('abort', abort),
        operation,
      });
      try {
        worker.postMessage({ id, operation, args, cancellation });
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
      closeResult = call('close', [])
        .then(async () => {
          await exited;
        })
        .catch((cause) => {
          throw new RetrievalMemoryError(
            'CLEANUP_FAILED',
            'SQLite backend could not close cleanly.',
            { cause }
          );
        });
      return closeResult;
    },
  };
}
