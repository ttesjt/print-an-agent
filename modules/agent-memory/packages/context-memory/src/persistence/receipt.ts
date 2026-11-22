import type { MemoryReceipt } from '../types/receipt.js';
import { ContextMemoryError } from '../errors.js';
import { parseCommandOutcomes, parseMutationRequest } from './request.js';
import { identity, integer, jsonValue, keys, record } from '../values/index.js';

export function parseMemoryReceipt(value: unknown): MemoryReceipt {
  const input = record(value, 'receipt');
  keys(input, [
    'memoryId',
    'requestId',
    'operation',
    'inputDigest',
    'status',
    'previousRevision',
    'revision',
    'changes',
    'commandOutcomes',
  ]);
  const { memoryId, requestId, operation } = parseMutationRequest({
    memoryId: input.memoryId,
    requestId: input.requestId,
    operation: input.operation,
    input: null,
  });
  if (input.status !== 'committed' && input.status !== 'unchanged')
    throw new ContextMemoryError('INPUT_INVALID', 'Invalid receipt status.');
  const previousRevision =
    input.previousRevision === null ? null : integer(input.previousRevision, 'previousRevision', 1);
  const revision = integer(input.revision, 'receipt revision', 1);
  if (
    (operation === 'create' || operation === 'fork') !== (previousRevision === null) ||
    revision !== (input.status === 'unchanged' ? previousRevision : (previousRevision ?? 0) + 1)
  )
    throw new ContextMemoryError('INPUT_INVALID', 'Inconsistent receipt revision.');
  const changes = record(input.changes, 'changes');
  keys(changes, ['addedItemIds', 'updatedItemIds', 'removedItemIds']);
  const ids = (value: unknown): readonly string[] => {
    const list = jsonValue(value);
    if (!Array.isArray(list))
      throw new ContextMemoryError('INPUT_INVALID', 'Changed identities must be an array.');
    const result = list.map((value) => identity(value, 'changed itemId'));
    if (new Set(result).size !== result.length)
      throw new ContextMemoryError('INPUT_INVALID', 'Duplicate changed identity.');
    return result;
  };
  const parsedChanges = {
    addedItemIds: ids(changes.addedItemIds),
    updatedItemIds: ids(changes.updatedItemIds),
    removedItemIds: ids(changes.removedItemIds),
  };
  const all = Object.values(parsedChanges).flat();
  if (new Set(all).size !== all.length || (input.status === 'unchanged' && all.length !== 0))
    throw new ContextMemoryError('INPUT_INVALID', 'Receipt changes conflict with its status.');
  return {
    memoryId,
    requestId,
    operation,
    inputDigest: identity(input.inputDigest, 'inputDigest'),
    status: input.status,
    previousRevision,
    revision,
    changes: parsedChanges,
    commandOutcomes: parseCommandOutcomes(input.commandOutcomes),
  };
}
