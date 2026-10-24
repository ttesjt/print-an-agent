import type { EntryBody, IndexConfiguration, MetadataFilter } from './data.js';
export interface SpaceInput {
  readonly memoryId: string;
}
export interface ReceiptInput extends SpaceInput {
  readonly requestId: string;
}
export interface CreateInput extends ReceiptInput {
  readonly index: IndexConfiguration;
}
export interface IngestInput extends ReceiptInput, EntryBody {}
export interface EntryInput extends SpaceInput {
  readonly entryId: string;
}
export interface EntryMutationInput extends ReceiptInput {
  readonly entryId: string;
  readonly expectedRevision: number;
}
export interface UpdateInput extends EntryMutationInput, EntryBody {}
export interface ListInput extends SpaceInput {
  readonly limit?: number;
  readonly cursor?: string;
}
export interface SearchInput extends SpaceInput {
  readonly query: string;
  readonly filter?: MetadataFilter;
  readonly topK?: number;
}
export type Mutation =
  | { readonly operation: 'create'; readonly input: CreateInput }
  | { readonly operation: 'ingest'; readonly input: IngestInput }
  | { readonly operation: 'update'; readonly input: UpdateInput }
  | { readonly operation: 'remove' | 'reindex'; readonly input: EntryMutationInput };
export type MutationOperation = Mutation['operation'];
