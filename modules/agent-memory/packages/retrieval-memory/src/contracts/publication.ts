import type { EntryRepresentation, RetrievalEntry, RetrievalSpace, StoredEntry } from './data.js';
import type { Mutation, MutationOperation } from './inputs.js';
export interface RetrievalReceipt {
  readonly memoryId: string;
  readonly requestId: string;
  readonly operation: MutationOperation;
  readonly inputDigest: string;
  readonly outcome: 'committed' | 'unchanged';
  readonly previousSequence: number;
  readonly sequence: number;
  readonly spaceRevision: number;
  readonly generationId: string;
  readonly entryId: string | null;
  readonly entryRevision: number | null;
  readonly representationId: string | null;
}
export type CommitEvidence =
  | { readonly status: 'not-committed' }
  | { readonly status: 'committed'; readonly receipt: RetrievalReceipt }
  | { readonly status: 'unknown'; readonly memoryId: string; readonly requestId: string };
export type MutationResult = {
  readonly status: 'committed' | 'unchanged';
  readonly receipt: RetrievalReceipt;
};
/** Detached candidate, never a transaction or resource lease. Rechecked inside publication. */
export interface RetrievalPublication {
  readonly mutation: Mutation;
  readonly space: RetrievalSpace;
  readonly expected: { readonly revision: number; readonly representationId: string } | null;
  readonly entry: RetrievalEntry | null;
  readonly representation: EntryRepresentation | null;
}
export interface PublicationDecision {
  readonly space: RetrievalSpace;
  readonly stored: StoredEntry | null;
  readonly receipt: RetrievalReceipt;
}
