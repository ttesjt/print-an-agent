import type {
  CreateInput,
  IngestInput,
  UpdateInput,
  EntryMutationInput,
  SpaceInput,
  EntryInput,
  ReceiptInput,
  ListInput,
  SearchInput,
} from '../contracts/inputs.js';
import type { EntryPage, RetrievalEntry, RetrievalSpace, SearchResult } from '../contracts/data.js';
import type { RetrievalReceipt } from '../contracts/publication.js';
import { createRetrievalMutationDefinition, type RetrievalMutationOptions } from './mutation.js';
import { createRetrievalQueryDefinition, type RetrievalQueryOptions } from './query.js';
export const createRetrievalCreateDefinition = (
  options: RetrievalMutationOptions<CreateInput> = {}
) => createRetrievalMutationDefinition('create', options);
export const createRetrievalIngestDefinition = (
  options: RetrievalMutationOptions<IngestInput> = {}
) => createRetrievalMutationDefinition('ingest', options);
export const createRetrievalUpdateDefinition = (
  options: RetrievalMutationOptions<UpdateInput> = {}
) => createRetrievalMutationDefinition('update', options);
export const createRetrievalRemoveDefinition = (
  options: RetrievalMutationOptions<EntryMutationInput, 'remove'> = {}
) => createRetrievalMutationDefinition('remove', options);
export const createRetrievalReindexDefinition = (
  options: RetrievalMutationOptions<EntryMutationInput> = {}
) => createRetrievalMutationDefinition('reindex', options);
export const createRetrievalInspectDefinition = (
  options: RetrievalQueryOptions<SpaceInput, RetrievalSpace, 'inspect'> = {}
) =>
  createRetrievalQueryDefinition<SpaceInput, RetrievalSpace, 'inspect'>(
    'inspect',
    (r, input, signal) => r.queries.inspect(input, signal),
    options
  );
export const createRetrievalGetDefinition = (
  options: RetrievalQueryOptions<EntryInput, RetrievalEntry, 'get'> = {}
) =>
  createRetrievalQueryDefinition<EntryInput, RetrievalEntry, 'get'>(
    'get',
    (r, input, signal) => r.queries.get(input, signal),
    options
  );
export const createRetrievalReceiptDefinition = (
  options: RetrievalQueryOptions<ReceiptInput, RetrievalReceipt | undefined, 'getReceipt'> = {}
) =>
  createRetrievalQueryDefinition<ReceiptInput, RetrievalReceipt | undefined, 'getReceipt'>(
    'getReceipt',
    (r, input, signal) => r.queries.getReceipt(input, signal),
    options,
    (value) => value
  );
export const createRetrievalListDefinition = (
  options: RetrievalQueryOptions<ListInput, EntryPage, 'list'> = {}
) =>
  createRetrievalQueryDefinition<ListInput, EntryPage, 'list'>(
    'list',
    (r, input, signal) => r.queries.list(input, signal),
    options
  );
export const createRetrievalSearchDefinition = (
  options: RetrievalQueryOptions<SearchInput, SearchResult> = {}
) =>
  createRetrievalQueryDefinition(
    'search',
    (r, input, signal) => r.queries.search(input, signal),
    options
  );
