import type { RetrievalMutationDefinition, RetrievalMutationOptions } from './types/workflow.js';
import type {
  CreateInput,
  IngestInput,
  UpdateInput,
  EntryMutationInput,
} from '../../types/mutation.js';
import { createRetrievalMutationDefinition } from './create-definition.js';

export const createRetrievalCreateDefinition = (
  options: RetrievalMutationOptions<CreateInput> = {}
): RetrievalMutationDefinition<CreateInput> => createRetrievalMutationDefinition('create', options);

export const createRetrievalIngestDefinition = (
  options: RetrievalMutationOptions<IngestInput> = {}
): RetrievalMutationDefinition<IngestInput> => createRetrievalMutationDefinition('ingest', options);

export const createRetrievalUpdateDefinition = (
  options: RetrievalMutationOptions<UpdateInput> = {}
): RetrievalMutationDefinition<UpdateInput> => createRetrievalMutationDefinition('update', options);

export const createRetrievalRemoveDefinition = (
  options: RetrievalMutationOptions<EntryMutationInput, 'remove'> = {}
): RetrievalMutationDefinition<EntryMutationInput, 'remove'> =>
  createRetrievalMutationDefinition('remove', options);

export const createRetrievalReindexDefinition = (
  options: RetrievalMutationOptions<EntryMutationInput> = {}
): RetrievalMutationDefinition<EntryMutationInput> =>
  createRetrievalMutationDefinition('reindex', options);
