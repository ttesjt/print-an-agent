import type { MemoryItem, MemorySnapshot } from '../contracts/document.js';
import type {
  MemoryChanges,
  MemoryReceipt,
  MutationRequest,
  StoreCommit,
} from '../contracts/receipt.js';
import { equalValue } from '../domain/digest.js';
import { ContextMemoryError } from '../errors.js';
import {
  parseCommandOutcomes,
  parseMutationRequest,
  requestDigest,
} from '../validation/request.js';
import { parseMemorySnapshot, parseMemoryState } from '../validation/state.js';
import { integer, keys, record } from '../validation/value.js';

export function parseStoreCommit(value: unknown): StoreCommit {
  const input = record(value, 'store commit');
  keys(input, ['request', 'expectedRevision', 'state', 'commandOutcomes']);
  const request = parseMutationRequest(input.request);
  const expectedRevision =
    input.expectedRevision === null ? null : integer(input.expectedRevision, 'expectedRevision', 1);
  if (
    (request.operation === 'create' || request.operation === 'fork') !==
    (expectedRevision === null)
  )
    throw new ContextMemoryError(
      'INPUT_INVALID',
      'Only creation accepts a null expected revision.'
    );
  return {
    request,
    expectedRevision,
    state: parseMemoryState(input.state),
    commandOutcomes: parseCommandOutcomes(input.commandOutcomes),
  };
}
export function summarizeMemoryChanges(
  before: readonly MemoryItem[],
  after: readonly MemoryItem[]
): MemoryChanges {
  const previous = new Map(before.map((item) => [item.id, item]));
  const next = new Map(after.map((item) => [item.id, item]));
  return {
    addedItemIds: after.filter((item) => !previous.has(item.id)).map((item) => item.id),
    updatedItemIds: after
      .filter((item) => previous.has(item.id) && !equalValue(item, previous.get(item.id)))
      .map((item) => item.id),
    removedItemIds: before.filter((item) => !next.has(item.id)).map((item) => item.id),
  };
}
export function assertReceiptMatches(receipt: MemoryReceipt, request: MutationRequest): void {
  if (
    receipt.memoryId !== request.memoryId ||
    receipt.requestId !== request.requestId ||
    receipt.operation !== request.operation ||
    receipt.inputDigest !== requestDigest(request)
  ) {
    throw new ContextMemoryError(
      'REQUEST_CONFLICT',
      'Request identity was already used with different business input.',
      { memoryId: request.memoryId, commit: { status: 'not-committed' } }
    );
  }
}
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
