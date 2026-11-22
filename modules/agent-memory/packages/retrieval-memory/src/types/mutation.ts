import type { EntryBody } from './entry.js';
import type { IndexConfiguration } from './space.js';
import type { ReceiptInput } from './identity.js';

export interface CreateInput extends ReceiptInput {
  readonly index: IndexConfiguration;
}

export interface IngestInput extends ReceiptInput, EntryBody {}

export interface EntryMutationInput extends ReceiptInput {
  readonly entryId: string;
  readonly expectedRevision: number;
}

export interface UpdateInput extends EntryMutationInput, EntryBody {}

export type Mutation =
  | { readonly operation: 'create'; readonly input: CreateInput }
  | { readonly operation: 'ingest'; readonly input: IngestInput }
  | { readonly operation: 'update'; readonly input: UpdateInput }
  | { readonly operation: 'remove' | 'reindex'; readonly input: EntryMutationInput };
