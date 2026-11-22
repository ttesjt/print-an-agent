import type { StoreCommit } from './types/store.js';
import { integer, keys, record } from '../values/index.js';
import { ContextMemoryError } from '../errors.js';
import { parseCommandOutcomes, parseMutationRequest } from './request.js';
import { parseMemoryState } from '../document/index.js';

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
