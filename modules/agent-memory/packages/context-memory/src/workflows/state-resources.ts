import type { MemoryStore } from '../persistence/index.js';
import type { MemoryStateResources } from './state/types.js';
import { loadMemory, replayMutation, parseMemoryReceipt } from '../persistence/index.js';
import { parseDeterministicMemoryRequest } from '../mutations/index.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { identity, jsonValue, keys, record } from '../values/index.js';

/** Raw authority queries require neither a tokenizer nor a renderer nor a model. */
export function createContextMemoryStateResources(store: MemoryStore): MemoryStateResources {
  return Object.freeze({
    memory: Object.freeze<MemoryStateResources['memory']>({
      async inspect(input, signal) {
        const data = record(jsonValue(input), 'memory lookup');
        keys(data, ['memoryId']);
        return loadMemory(
          store,
          identity(data.memoryId, 'memoryId'),
          signal ?? new AbortController().signal
        );
      },
      async replay(input, signal) {
        const data = record(jsonValue(input), 'mutation replay');
        keys(data, ['operation', 'input']);
        if (
          data.operation !== 'create' &&
          data.operation !== 'apply' &&
          data.operation !== 'configure'
        )
          throw new ContextMemoryError('INPUT_INVALID', 'Unknown deterministic mutation.');
        const { request } = parseDeterministicMemoryRequest(data.operation, data.input);
        return replayMutation(store, request, signal ?? new AbortController().signal);
      },
      async getReceipt(input, signal) {
        assertMemoryNotAborted(signal);
        const data = record(jsonValue(input), 'receipt lookup');
        keys(data, ['memoryId', 'requestId']);
        const memoryId = identity(data.memoryId, 'memoryId');
        const requestId = identity(data.requestId, 'requestId');
        try {
          const value = await store.getReceipt(memoryId, requestId, signal);
          if (value === undefined) {
            assertMemoryNotAborted(signal);
            return undefined;
          }
          const receipt = parseMemoryReceipt(value);
          if (receipt.memoryId !== memoryId || receipt.requestId !== requestId)
            throw new Error('Receipt scope mismatch.');
          return receipt;
        } catch (cause) {
          assertMemoryNotAborted(signal);
          throw new ContextMemoryError('STORAGE_FAILED', 'Memory receipt could not be read.', {
            memoryId,
            cause,
          });
        }
      },
    }),
  });
}
