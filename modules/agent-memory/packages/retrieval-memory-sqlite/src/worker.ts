import { parentPort, workerData } from 'node:worker_threads';
import {
  identifier,
  RetrievalMemoryError,
  type RetrievalPublication,
  type BackendSearch,
} from '@print-an-agent/retrieval-memory';
import { openDatabase, type SqliteDatabaseConfiguration } from './database/index.js';
import { getEntry, getReceipt, inspectSpace } from './database/index.js';
import { publish } from './database/index.js';
import { searchEntries } from './database/index.js';
import { listEntries } from './database/index.js';
import { checkCancellation } from './cancellation.js';
import type { WorkerRequest, WorkerReply } from './protocol.js';
import { failureDetails } from './failures.js';
const port = parentPort;
if (port === null) throw new Error('SQLite retrieval worker needs a host.');
const db = openDatabase(workerData as SqliteDatabaseConfiguration);
let cleanupFailure: RetrievalMemoryError | undefined;
port.postMessage({ ready: true });
port.on('message', (request: WorkerRequest) => {
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
    const [a, b] = request.args;
    let value: unknown;
    switch (request.operation) {
      case 'inspect':
        value = inspectSpace(db, identifier(a));
        break;
      case 'get':
        value = getEntry(db, identifier(a), identifier(b), flag);
        break;
      case 'getReceipt':
        value = getReceipt(db, identifier(a), identifier(b));
        break;
      case 'publish':
        value = publish(db, a as RetrievalPublication, flag);
        break;
      case 'list':
        value = listEntries(db, a as { memoryId: string; limit: number; cursor?: string }, flag);
        break;
      case 'search':
        value = searchEntries(db, a as BackendSearch, flag);
        break;
      case 'close':
        db.close();
        if (cleanupFailure !== undefined) throw cleanupFailure;
        send({ id: request.id, value: undefined });
        port.close();
        return;
    }
    // Publication and an observed durable receipt retain their facts after late cancellation.
    if (
      request.operation !== 'publish' &&
      !(request.operation === 'getReceipt' && value !== undefined)
    )
      checkCancellation(flag);
    send({ id: request.id, value });
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
