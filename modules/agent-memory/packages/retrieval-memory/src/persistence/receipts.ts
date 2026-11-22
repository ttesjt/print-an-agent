import { isMutationOperation } from '../mutation-operations.js';
import type { Mutation } from '../types/mutation.js';
import type { MutationOperation } from '../mutation-operations.js';
import type { RetrievalReceipt } from '../types/publication.js';
import { mutationDigest } from './request.js';
import { identifier, integer, record, text } from '../values/index.js';
import { fail } from '../errors.js';

export function parseRetrievalReceipt(value: unknown): RetrievalReceipt {
  const data = record(value);
  if (
    !isMutationOperation(text(data.operation)) ||
    !['committed', 'unchanged'].includes(text(data.outcome))
  )
    fail('STORAGE_FAILED', 'Invalid durable receipt.');
  identifier(data.memoryId);
  identifier(data.requestId);
  identifier(data.generationId);
  if (!/^[a-f0-9]{64}$/.test(text(data.inputDigest)))
    fail('STORAGE_FAILED', 'Invalid receipt fingerprint.');
  integer(data.previousSequence, 0);
  integer(data.sequence, 0);
  integer(data.spaceRevision);
  if (data.entryId !== null) identifier(data.entryId);
  if (data.entryRevision !== null) integer(data.entryRevision);
  if (data.representationId !== null) identifier(data.representationId);
  return {
    memoryId: identifier(data.memoryId),
    requestId: identifier(data.requestId),
    operation: data.operation as MutationOperation,
    inputDigest: text(data.inputDigest),
    outcome: data.outcome as RetrievalReceipt['outcome'],
    previousSequence: integer(data.previousSequence, 0),
    sequence: integer(data.sequence, 0),
    spaceRevision: integer(data.spaceRevision),
    generationId: identifier(data.generationId),
    entryId: data.entryId === null ? null : identifier(data.entryId),
    entryRevision: data.entryRevision === null ? null : integer(data.entryRevision),
    representationId: data.representationId === null ? null : identifier(data.representationId),
  };
}

export function assertReceiptMatches(receipt: RetrievalReceipt, mutation: Mutation): void {
  if (
    receipt.memoryId !== mutation.input.memoryId ||
    receipt.requestId !== mutation.input.requestId ||
    receipt.operation !== mutation.operation ||
    receipt.inputDigest !== mutationDigest(mutation)
  )
    fail('REQUEST_CONFLICT', 'Request ID was already used for different business input.');
}
