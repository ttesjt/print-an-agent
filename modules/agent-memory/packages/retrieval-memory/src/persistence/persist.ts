import type { RetrievalBackend } from './types/ports.js';
import type { MutationResult } from '../types/publication.js';
import type { PreparedMutation } from './types/publication.js';
import { assertNotAborted, RetrievalMemoryError } from '../errors.js';
import { validatePublication } from './validate-publication.js';
import { assertReceiptMatches, parseRetrievalReceipt } from './receipts.js';

export async function persistRetrieval(
  backend: RetrievalBackend,
  prepared: PreparedMutation,
  signal: AbortSignal
): Promise<MutationResult> {
  if ('receipt' in prepared) {
    const receipt = parseRetrievalReceipt(prepared.receipt);
    return { status: receipt.outcome, receipt };
  }
  const publication = validatePublication(prepared.publication);
  assertNotAborted(signal);
  let raw;
  try {
    raw = await backend.publish(publication, signal);
  } catch (cause) {
    if (cause instanceof RetrievalMemoryError && cause.commit !== undefined) throw cause;
    throw new RetrievalMemoryError(
      'COMMIT_UNKNOWN',
      'Publication result is unknown; recover the same request receipt.',
      {
        cause,
        commit: {
          status: 'unknown',
          memoryId: publication.mutation.input.memoryId,
          requestId: publication.mutation.input.requestId,
        },
      }
    );
  }
  try {
    const receipt = parseRetrievalReceipt(raw);
    assertReceiptMatches(receipt, publication.mutation);
    return { status: receipt.outcome, receipt };
  } catch (cause) {
    throw new RetrievalMemoryError(
      'COMMIT_UNKNOWN',
      'Publication receipt could not be established.',
      {
        cause,
        commit: {
          status: 'unknown',
          memoryId: publication.mutation.input.memoryId,
          requestId: publication.mutation.input.requestId,
        },
      }
    );
  }
}
