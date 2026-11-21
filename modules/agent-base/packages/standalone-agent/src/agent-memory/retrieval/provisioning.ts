import type { RetrievalMemoryManagementCapability } from '@print-an-agent/base-composition';
import {
  createRetrievalContext,
  createRetrievalQueries,
  createRetrievalReadContextDefinition,
  createRetrievalSearchDefinition,
  defineRetrievalPolicy,
  parseMutation,
  replayRetrievalMutation,
} from '@print-an-agent/retrieval-memory';
import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import { DEFAULT_MEMORY_MEASUREMENT_REF } from '../provisioning/recipe.js';
import { resolveMemoryResource } from '../provisioning/resolve-resource.js';
import type { MemoryAllocationResolver } from '../types/allocation.js';
import type { StandaloneMemoryManagementOptions } from '../types/options.js';
import { createRetrievalMemoryResourceResolvers } from './resources.js';

export function retrievalMemoryProvisioning<N>(
  options: StandaloneMemoryManagementOptions,
  allocation: MemoryAllocationResolver<N>
): RetrievalMemoryManagementCapability<N>['retrievalMemoryManagement'] {
  const config = options.retrieval ?? {};
  const { state, models, writable } = createRetrievalMemoryResourceResolvers(options, allocation);
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
