import {
  scopedAgentMemoryId,
  type RetrievalMemoryManagementCapability,
  type MemoryManagementOptions,
  type MemoryProvisioningRequest,
} from '@ta-agent/base-composition';
import {
  createRetrievalContentBundle,
  createRetrievalQueries,
  createRetrievalContext,
  createRetrievalReadContextDefinition,
  createRetrievalSearchDefinition,
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  replayRetrievalMutation,
  parseMutation,
  defineRetrievalPolicy,
  RetrievalMemoryError,
  type SpaceInput,
} from '@ta-agent/retrieval-memory';
import { WorkflowBundle } from '@ta-agent/workflow-bundle';
import { DEFAULT_MEMORY_MEASUREMENT_REF } from './recipe.js';
import type { StandaloneMemoryManagementOptions } from './contracts.js';
import type { MemoryAllocationResolver } from './context.js';
import { resolveMemoryResource } from './resolve.js';

export function retrievalMemoryProvisioning<N>(
  options: StandaloneMemoryManagementOptions,
  allocation: MemoryAllocationResolver<N>
): RetrievalMemoryManagementCapability<N>['retrievalMemoryManagement'] {
  const config = options.retrieval ?? {};
  async function state<I extends SpaceInput>(
    request: MemoryProvisioningRequest<N, I>,
    call?: MemoryManagementOptions
  ) {
    const { registry, recipe } = await allocation(request.namespace);
    const memoryId = scopedAgentMemoryId(
      options.storageNamespaceId,
      request.namespace.agentId,
      request.input.memoryId,
      config.policy?.maxIdBytes === undefined ? 1024 : config.policy.maxIdBytes
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
  ) {
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
  ) {
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
  return {
    resolve: {
      inspect: async (request, call) => {
        const s = await state(request, call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.inspect.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      get: async (request, call) => {
        const s = await state(request, call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.get.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      getReceipt: async (request, call) => {
        const s = await state(request, call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.getReceipt.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      list: async (request, call) => {
        const s = await state(request, call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.list.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      remove: async (request, call) => {
        const s = await state(request, call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.remove.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      replay: async (request, call) => {
        const s = await state({ namespace: request.namespace, input: request.input.input }, call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            replayRetrievalMutation(
              s.backend,
              parseMutation(
                request.input.operation,
                { ...request.input.input, memoryId: s.memoryId },
                defineRetrievalPolicy(config.policy)
              ),
              signal,
              config.policy
            ),
        };
      },
      create: async (request, call) => {
        const s = await writable(request, call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.create.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      ingest: async (request, call) => {
        const s = await writable(request, call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.ingest.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      update: async (request, call) => {
        const s = await writable(request, call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.update.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      reindex: async (request, call) => {
        const s = await writable(request, call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.reindex.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      search: async (request, call) => {
        const s = await models(request, call);
        const bundle = new WorkflowBundle({
          resources: {
            queries: createRetrievalQueries(
              { backend: s.backend, embeddings: s.embeddings },
              config.policy
            ),
          },
          workflows: { search: config.workflows?.search ?? createRetrievalSearchDefinition() },
        });
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            bundle.workflows.search.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      readContext: async (request, call) => {
        const s = await models(request, call);
        const counter =
          request.input.maxTokens === null
            ? undefined
            : await resolveMemoryResource(
                'retrieval',
                s.registry,
                s.recipe.retrievalCounter.request(
                  config.measurementRef ?? DEFAULT_MEMORY_MEASUREMENT_REF
                ),
                call
              );
        const context = createRetrievalContext(
          createRetrievalQueries({ backend: s.backend, embeddings: s.embeddings }, config.policy),
          counter === undefined ? {} : { counter },
          config.policy
        );
        const bundle = new WorkflowBundle({
          resources: { context },
          workflows: {
            readContext: config.workflows?.readContext ?? createRetrievalReadContextDefinition(),
          },
        });
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            bundle.workflows.readContext.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
    },
  };
}
