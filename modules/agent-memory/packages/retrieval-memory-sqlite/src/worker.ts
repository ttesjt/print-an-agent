import { parentPort, workerData } from 'node:worker_threads';
import {
  identifier,
  RetrievalMemoryError,
  type RetrievalPublication,
  type BackendSearch,
} from '@ta-agent/retrieval-memory';
import { openDatabase } from './database/schema.js';
import { readEntry, readReceipt, readSpace } from './database/records.js';
import { publish } from './database/publication.js';
import { listEntries, searchEntries } from './database/queries.js';
import { checkCancellation } from './database/transaction.js';
import type { WorkerConfiguration, WorkerRequest, WorkerReply } from './protocol.js';
import { failureDetails } from './failures.js';
const port = parentPort;
if (port === null) throw new Error('SQLite retrieval worker needs a host.');
const db = openDatabase(workerData as WorkerConfiguration);
const cleanupFailures: Error[] = [];
port.postMessage({ ready: true });
port.on('message', (request: WorkerRequest) => {
  const flag = new Int32Array(request.cancellation);
  const send = (reply: WorkerReply) => port.postMessage(reply);
  try {
    checkCancellation(flag);
    const [a, b] = request.args;
    let value: unknown;
    switch (request.operation) {
      case 'inspect':
        value = readSpace(db, identifier(a));
        break;
      case 'get':
        value = readEntry(db, identifier(a), identifier(b));
        break;
      case 'getReceipt':
        value = readReceipt(db, identifier(a), identifier(b));
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
        if (cleanupFailures.length > 0)
          throw new RetrievalMemoryError(
            'CLEANUP_FAILED',
            'Earlier SQLite cleanup failures remain unresolved.',
            { cause: new AggregateError(cleanupFailures) }
          );
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
      cause instanceof RetrievalMemoryError
        ? cause
        : new RetrievalMemoryError(
            request.operation === 'close' ? 'CLEANUP_FAILED' : 'STORAGE_FAILED',
            'SQLite retrieval operation failed.',
            { cause }
          );
    if (error.code === 'CLEANUP_FAILED') cleanupFailures.push(error);
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
