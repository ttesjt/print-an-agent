import type { MemorySnapshot } from '../types/document.js';
import type { MemoryReceipt } from '../types/receipt.js';
import type { StoreCommit } from './types/store.js';
import { equalValue, integer } from '../values/index.js';
import { ContextMemoryError } from '../errors.js';
import { requestDigest } from './request.js';
import { parseMemorySnapshot } from '../document/index.js';
import { parseStoreCommit } from './commit-input.js';
import { summarizeMemoryChanges } from './changes.js';

/** Run inside the adapter's atomic request/CAS boundary, after checking for an existing receipt. */
export function decideMemoryCommit(
  previousInput: MemorySnapshot | undefined,
  changeInput: StoreCommit
): { snapshot: MemorySnapshot; receipt: MemoryReceipt } {
  const change = parseStoreCommit(changeInput);
  const previous = previousInput === undefined ? undefined : parseMemorySnapshot(previousInput);
  const { request, expectedRevision, state } = change;
  const fail = (
    code: 'MEMORY_ALREADY_EXISTS' | 'MEMORY_NOT_FOUND' | 'REVISION_CONFLICT',
    message: string
  ): never => {
    throw new ContextMemoryError(code, message, {
      memoryId: request.memoryId,
      details: { expectedRevision, actualRevision: previous?.revision ?? null },
      commit: { status: 'not-committed' },
    });
  };
  if (previous !== undefined && previous.memoryId !== request.memoryId)
    throw new ContextMemoryError('INPUT_INVALID', 'Snapshot scope mismatch.');
  if (expectedRevision === null && previous !== undefined)
    fail('MEMORY_ALREADY_EXISTS', 'Memory already exists.');
  if (expectedRevision !== null && previous === undefined)
    fail('MEMORY_NOT_FOUND', 'Memory was not found.');
  if (previous !== undefined && previous.revision !== expectedRevision)
    fail('REVISION_CONFLICT', 'Memory revision changed.');
  const unchanged =
    previous !== undefined &&
    equalValue(previous.items, state.items) &&
    equalValue(previous.config, state.config);
  const revision = unchanged
    ? previous.revision
    : integer((previous?.revision ?? 0) + 1, 'next revision', 1);
  return {
    snapshot: unchanged ? previous : { memoryId: request.memoryId, revision, ...state },
    receipt: {
      memoryId: request.memoryId,
      requestId: request.requestId,
      operation: request.operation,
      inputDigest: requestDigest(request),
      status: unchanged ? 'unchanged' : 'committed',
      previousRevision: previous?.revision ?? null,
      revision,
      changes: summarizeMemoryChanges(previous?.items ?? [], state.items),
      commandOutcomes: change.commandOutcomes,
    },
  };
}
