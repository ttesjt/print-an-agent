import type { DatabaseSync } from 'node:sqlite';
import { identifier } from '@print-an-agent/retrieval-memory';
import {
  getEntry,
  getReceipt,
  inspectSpace,
  publish,
  listEntries,
  searchEntries,
} from '../database/index.js';
import type { WorkerRequest, WorkerSuccess } from './protocol/index.js';

export function dispatch(
  db: DatabaseSync,
  request: Exclude<WorkerRequest, { readonly operation: 'close' }>,
  flag: Int32Array
): WorkerSuccess {
  switch (request.operation) {
    case 'inspect':
      return {
        id: request.id,
        operation: request.operation,
        value: inspectSpace(db, identifier(request.args[0])),
      };
    case 'get':
      return {
        id: request.id,
        operation: request.operation,
        value: getEntry(db, identifier(request.args[0]), identifier(request.args[1]), flag),
      };
    case 'getReceipt':
      return {
        id: request.id,
        operation: request.operation,
        value: getReceipt(db, identifier(request.args[0]), identifier(request.args[1])),
      };
    case 'publish':
      return {
        id: request.id,
        operation: request.operation,
        value: publish(db, request.args[0], flag),
      };
    case 'list':
      return {
        id: request.id,
        operation: request.operation,
        value: listEntries(db, request.args[0], flag),
      };
    case 'search':
      return {
        id: request.id,
        operation: request.operation,
        value: searchEntries(db, request.args[0], flag),
      };
  }
}
