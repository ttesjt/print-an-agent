import type {
  CreateInput,
  IngestInput,
  UpdateInput,
  EntryMutationInput,
} from '../types/mutation.js';
import type { SpaceInput, EntryInput, ReceiptInput } from '../types/identity.js';
import type { ListInput, SearchInput } from '../queries/index.js';
import type { EntryPage, RetrievalEntry } from '../types/entry.js';
import type { RetrievalSpace } from '../types/space.js';
import type { SearchResult } from '../types/search.js';
import type { RetrievalReceipt } from '../types/publication.js';
import { createRetrievalMutationDefinition } from './mutation.js';
import type { RetrievalMutationOptions } from './mutation/types/workflow.js';
import { createRetrievalQueryDefinition } from './query.js';
import type { RetrievalQueryOptions } from './query/types/workflow.js';

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
