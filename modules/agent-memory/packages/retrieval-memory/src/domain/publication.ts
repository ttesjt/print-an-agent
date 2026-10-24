import type { RetrievalSpace, StoredEntry } from '../contracts/data.js';
import type {
  PublicationDecision,
  RetrievalPublication,
  RetrievalReceipt,
} from '../contracts/publication.js';
import { mutationDigest, entryBody } from '../validation/input.js';
import { RETRIEVAL_PROTOCOL_POLICY } from '../config.js';
import { equal } from '../validation/json.js';
import { parseRetrievalSpace } from '../validation/state.js';
import { validatePublication } from '../validation/publication.js';
import { assertReceiptMatches, parseRetrievalReceipt } from './receipts.js';
import { RetrievalMemoryError, fail } from '../errors.js';
/** Must run inside an adapter's atomic authority/index/receipt boundary, with receipt arbitration first. */
export function decideRetrievalPublication(
  spaceInput: RetrievalSpace | undefined,
  current: StoredEntry | undefined,
  receiptInput: RetrievalReceipt | undefined,
  candidate: RetrievalPublication
): PublicationDecision | { receipt: RetrievalReceipt } {
  const change = validatePublication(candidate);
  if (receiptInput !== undefined) {
    const receipt = parseRetrievalReceipt(receiptInput);
    assertReceiptMatches(receipt, change.mutation);
    return { receipt };
  }
  const { mutation, expected, entry, representation } = change;
  const reject = (
    code: 'MEMORY_ALREADY_EXISTS' | 'MEMORY_NOT_FOUND' | 'REVISION_CONFLICT' | 'ENTRY_NOT_FOUND'
  ): never => {
    throw new RetrievalMemoryError(code, 'Publication authority precondition failed.', {
      commit: { status: 'not-committed' },
    });
  };
  if (mutation.operation === 'create' && spaceInput !== undefined) reject('MEMORY_ALREADY_EXISTS');
  if (mutation.operation !== 'create' && spaceInput === undefined) reject('MEMORY_NOT_FOUND');
  const previous = spaceInput === undefined ? undefined : parseRetrievalSpace(spaceInput);
  if (
    previous !== undefined &&
    (previous.memoryId !== change.space.memoryId ||
      previous.revision !== change.space.revision ||
      !equal(previous.index, change.space.index))
  )
    reject('REVISION_CONFLICT');
  if (
    mutation.operation === 'ingest' &&
    (expected !== null || entry?.revision !== 1 || current !== undefined)
  )
    reject('REVISION_CONFLICT');
  if (expected !== null && current === undefined) reject('ENTRY_NOT_FOUND');
  if (
    expected !== null &&
    current !== undefined &&
    (current.entry.revision !== expected.revision ||
      current.representation.representationId !== expected.representationId)
  )
    reject('REVISION_CONFLICT');
  if (
    current !== undefined &&
    (current.entry.memoryId !== change.space.memoryId ||
      (mutation.operation !== 'ingest' &&
        mutation.operation !== 'create' &&
        current.entry.entryId !== mutation.input.entryId))
  )
    fail('REPRESENTATION_INVALID', 'Current Entry scope mismatch.');
  const unchanged =
    mutation.operation === 'update' &&
    current !== undefined &&
    entry !== null &&
    equal(
      entryBody(current.entry, RETRIEVAL_PROTOCOL_POLICY),
      entryBody(entry, RETRIEVAL_PROTOCOL_POLICY)
    );
  if (
    entry !== null &&
    mutation.operation === 'update' &&
    entry.revision !== (expected?.revision ?? 0) + (unchanged ? 0 : 1)
  )
    fail('REPRESENTATION_INVALID', 'Candidate revision is invalid.');
  if (mutation.operation === 'reindex' && !equal(current?.entry, entry))
    fail('REPRESENTATION_INVALID', 'Reindex cannot modify authoritative content.');
  if (unchanged && !equal(current?.representation, representation))
    fail('REPRESENTATION_INVALID', 'Unchanged update cannot replace representation.');
  if (
    mutation.operation === 'reindex' &&
    current?.representation.representationId === representation?.representationId
  )
    fail('REPRESENTATION_INVALID', 'Reindex requires a fresh representation.');
  const previousSequence = previous?.sequence ?? 0;
  const space = {
    ...change.space,
    sequence: previousSequence + (mutation.operation === 'create' || unchanged ? 0 : 1),
  };
  if (!Number.isSafeInteger(space.sequence)) fail('STORAGE_FAILED', 'Space sequence exhausted.');
  return {
    space,
    stored: entry === null || representation === null ? null : { entry, representation },
    receipt: {
      memoryId: space.memoryId,
      requestId: mutation.input.requestId,
      operation: mutation.operation,
      inputDigest: mutationDigest(mutation),
      outcome: unchanged ? 'unchanged' : 'committed',
      previousSequence,
      sequence: space.sequence,
      spaceRevision: space.revision,
      generationId: space.index.generationId,
      entryId: entry?.entryId ?? (mutation.operation === 'remove' ? mutation.input.entryId : null),
      entryRevision:
        entry?.revision ??
        (mutation.operation === 'remove' ? mutation.input.expectedRevision : null),
      representationId: representation?.representationId ?? null,
    },
  };
}
