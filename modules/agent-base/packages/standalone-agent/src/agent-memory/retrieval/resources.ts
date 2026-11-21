import {
  scopedAgentMemoryId,
  type MemoryManagementOptions,
  type MemoryProvisioningRequest,
} from '@print-an-agent/base-composition';
import {
  createRetrievalContentBundle,
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  DEFAULT_RETRIEVAL_POLICY,
  RetrievalMemoryError,
  type SpaceInput,
} from '@print-an-agent/retrieval-memory';
import { resolveMemoryResource } from '../provisioning/resolve-resource.js';
import type { MemoryAllocationResolver } from '../types/allocation.js';
import type { StandaloneMemoryManagementOptions } from '../types/options.js';
import type {
  IndexedRetrievalMemory,
  RetrievalMemoryResourceResolvers,
  RetrievalMemoryState,
  WritableRetrievalMemory,
} from './types.js';

export function createRetrievalMemoryResourceResolvers<N>(
  options: StandaloneMemoryManagementOptions,
  allocation: MemoryAllocationResolver<N>
): RetrievalMemoryResourceResolvers<N> {
  const config = options.retrieval ?? {};
  async function state<I extends SpaceInput>(
    request: MemoryProvisioningRequest<N, I>,
    call?: MemoryManagementOptions
  ): Promise<RetrievalMemoryState<I>> {
    const { registry, recipe } = await allocation(request.namespace);
    const memoryId = scopedAgentMemoryId(
      options.storageNamespaceId,
      request.namespace.agentId,
      request.input.memoryId,
      config.policy?.maxIdBytes === undefined
        ? DEFAULT_RETRIEVAL_POLICY.maxIdBytes
        : config.policy.maxIdBytes
    );
    const backend = await resolveMemoryResource(
      'retrieval',
      registry,
      recipe.backend.request('authority'),
      call
    );
    const bundle = createRetrievalContentBundle({
      backend,
      ...(config.policy === undefined ? {} : { policy: config.policy }),
      ...(config.workflows === undefined ? {} : { workflows: config.workflows }),
    });
    return { registry, recipe, memoryId, backend, input: { ...request.input, memoryId }, bundle };
  }
  async function models<I extends SpaceInput>(
    request: MemoryProvisioningRequest<N, I>,
    call?: MemoryManagementOptions
  ): Promise<IndexedRetrievalMemory<I>> {
    const s = await state(request, call);
    const space = await s.backend.inspect(s.memoryId, call?.signal);
    const index = 'index' in request.input ? request.input.index : space?.index;
    if (
      index === undefined ||
      typeof index !== 'object' ||
      index === null ||
      !('embeddingRef' in index) ||
      typeof index.embeddingRef !== 'string' ||
      !('chunkerRef' in index) ||
      typeof index.chunkerRef !== 'string'
    )
      throw new RetrievalMemoryError(
        space === undefined ? 'MEMORY_NOT_FOUND' : 'INPUT_INVALID',
        'Retrieval index is not available.'
      );
    const embedding = await resolveMemoryResource(
      'retrieval',
      s.registry,
      s.recipe.embedding.request(index.embeddingRef),
      call
    );
    const embeddings = {
      resolve: (ref: string) => {
        if (ref !== index.embeddingRef)
          throw new RetrievalMemoryError('EMBEDDING_MISMATCH', 'Embedding binding changed.');
        return embedding;
      },
    };
    return {
      ...s,
      index: { embeddingRef: index.embeddingRef, chunkerRef: index.chunkerRef },
      embeddings,
    };
  }
  async function writable<I extends SpaceInput>(
    request: MemoryProvisioningRequest<N, I>,
    call?: MemoryManagementOptions
  ): Promise<WritableRetrievalMemory<I>> {
    const s = await models(request, call);
    const chunker = await resolveMemoryResource(
      'retrieval',
      s.registry,
      s.recipe.chunker.request(s.index.chunkerRef),
      call
    );
    const resources = createRetrievalWorkflowResources(
      {
        backend: s.backend,
        embeddings: s.embeddings,
        chunkers: {
          resolve: (ref) => {
            if (ref !== s.index.chunkerRef)
              throw new RetrievalMemoryError('REPRESENTATION_INVALID', 'Chunker binding changed.');
            return chunker;
          },
        },
      },
      { ...(config.policy === undefined ? {} : { policy: config.policy }) }
    );
    return {
      ...s,
      bundle: createRetrievalMemoryBundle({
        resources,
        ...(config.workflows === undefined ? {} : { workflows: config.workflows }),
      }),
    };
  }

  return { state, models, writable };
}
