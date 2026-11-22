import type { MessagePort } from 'node:worker_threads';
import { RetrievalMemoryError } from '@print-an-agent/retrieval-memory';
import { openDatabase, type SqliteDatabaseConfiguration } from '../database/index.js';
import { checkCancellation } from '../cancellation.js';
import { readWorkerRequest, failureDetails, type WorkerReply } from './protocol/index.js';
import { dispatch } from './dispatch.js';

export function runWorker(port: MessagePort, configuration: SqliteDatabaseConfiguration): void {
  const db = openDatabase(configuration);
  let cleanupFailure: RetrievalMemoryError | undefined;
  port.postMessage({ ready: true });
  port.on('message', (message: unknown) => {
    const request = readWorkerRequest(message);
    const flag = new Int32Array(request.cancellation);
    const send = (reply: WorkerReply) => port.postMessage(reply);
    try {
      // A failed rollback can leave transaction-local rows visible on this connection.
      // Fence even already-queued reads/receipt recovery; only the host may close it.
      if (request.operation !== 'close' && cleanupFailure !== undefined)
        throw new RetrievalMemoryError(
          'CLEANUP_FAILED',
          'SQLite connection is fenced after cleanup failure.',
          {
            cause: cleanupFailure,
            ...(request.operation === 'publish'
              ? { commit: { status: 'not-committed' } as const }
              : {}),
          }
        );
      checkCancellation(flag);
      if (request.operation === 'close') {
        db.close();
        if (cleanupFailure !== undefined) throw cleanupFailure;
        send({ id: request.id, operation: 'close', value: undefined });
        port.close();
        return;
      }
      const reply = dispatch(db, request, flag);
      // Publication and an observed durable receipt retain their facts after late cancellation.
      if (
        request.operation !== 'publish' &&
        !(request.operation === 'getReceipt' && reply.value !== undefined)
      )
        checkCancellation(flag);
      send(reply);
    } catch (cause) {
      const error =
        request.operation === 'close' && cleanupFailure !== undefined && cause !== cleanupFailure
          ? new RetrievalMemoryError('CLEANUP_FAILED', 'SQLite cleanup and close failed.', {
              cause: new AggregateError([cleanupFailure, cause]),
            })
          : cause instanceof RetrievalMemoryError
            ? cause
            : new RetrievalMemoryError(
                request.operation === 'close' ? 'CLEANUP_FAILED' : 'STORAGE_FAILED',
                'SQLite retrieval operation failed.',
                { cause }
              );
      if (error.code === 'CLEANUP_FAILED') cleanupFailure ??= error;
      send({
        id: request.id,
        error: {
          code: error.code,
          message: error.message,
          ...(error.stack === undefined ? {} : { stack: error.stack }),
          causes: failureDetails(error.cause),
          ...(error.commit === undefined
            ? request.operation === 'publish' && error.code === 'OPERATION_ABORTED'
              ? { commit: { status: 'not-committed' } as const }
              : {}
            : { commit: error.commit }),
        },
      });
      if (request.operation === 'close') port.close();
    }
  });
}
