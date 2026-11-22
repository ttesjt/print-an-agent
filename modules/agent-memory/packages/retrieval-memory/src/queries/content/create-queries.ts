import type { RetrievalContentQueryOperations } from './types/operations.js';
import type { RetrievalContentQueryResources } from './types/resources.js';
import { defineRetrievalPolicy } from '../../policy/index.js';
import type { RetrievalPolicy } from '../../policy/index.js';
import { assertNotAborted, fail } from '../../errors.js';
import { requireEntry, requireSpace, parseRetrievalReceipt } from '../../persistence/index.js';
import { parseEntryInput, parseListInput, parseReceiptInput, parseSpaceInput } from './input.js';
import { identifier, record } from '../../values/index.js';

export function createContentQueries(
  resources: RetrievalContentQueryResources,
  options: Partial<RetrievalPolicy> = {}
): RetrievalContentQueryOperations {
  const policy = defineRetrievalPolicy(options);
  return {
    async inspect(value, signal) {
      const input = parseSpaceInput(value, policy);
      return requireSpace(resources.backend, input.memoryId, signal);
    },
    async get(value, signal) {
      const input = parseEntryInput(value, policy);
      const space = await requireSpace(resources.backend, input.memoryId, signal);
      return (await requireEntry(resources.backend, space, input.entryId, signal)).entry;
    },
    async getReceipt(value, signal) {
      const input = parseReceiptInput(value, policy);
      assertNotAborted(signal);
      const value_ = await resources.backend.getReceipt(input.memoryId, input.requestId, signal);
      if (value_ === undefined) {
        assertNotAborted(signal);
        return undefined;
      }
      const receipt = parseRetrievalReceipt(value_);
      if (receipt.memoryId !== input.memoryId || receipt.requestId !== input.requestId)
        fail('STORAGE_FAILED', 'Receipt scope mismatch.');
      return receipt;
    },
    async list(value, signal) {
      const input = parseListInput(value, policy);
      assertNotAborted(signal);
      const result = await resources.backend.list(input, signal);
      assertNotAborted(signal);
      record(result);
      if (
        result.space.memoryId !== input.memoryId ||
        result.entries.length > input.limit ||
        result.entries.some((entry) => entry.memoryId !== input.memoryId || 'content' in entry)
      )
        fail('STORAGE_FAILED', 'Invalid Entry page.');
      if (result.nextCursor !== null) identifier(result.nextCursor, policy.maxCursorBytes);
      return structuredClone(result);
    },
  };
}
