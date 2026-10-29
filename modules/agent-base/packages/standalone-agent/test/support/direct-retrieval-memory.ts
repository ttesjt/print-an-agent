import {
  scopedAgentMemoryId,
  type ManagedAgentNamespacePort,
  type MemoryProvisioningRequest,
  type RetrievalMemoryManagementCapability,
} from '@ta-agent/base-composition';
import {
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  parseMutation,
  replayRetrievalMutation,
  type RetrievalResources,
} from '@ta-agent/retrieval-memory';

/** Non-Registry consumer: borrowed explicit resources, native workflows and native replay only. */
export function directRetrievalMemory<N>(
  namespace: ManagedAgentNamespacePort<N>,
  resources: RetrievalResources
) {
  const bundle = createRetrievalMemoryBundle({
    resources: createRetrievalWorkflowResources(resources),
  });
  function bind<I extends { memoryId: string }, O>(
    request: MemoryProvisioningRequest<N, I>,
    invoke: (input: I, signal?: AbortSignal) => Promise<O>
  ) {
    const memoryId = scopedAgentMemoryId(
      'direct',
      request.namespace.agentId,
      request.input.memoryId
    );
    return {
      memoryId,
      invoke: (signal?: AbortSignal) => invoke({ ...request.input, memoryId }, signal),
    };
  }
  const context: RetrievalMemoryManagementCapability<N> = {
    retrievalMemoryManagement: {
      resolve: {
        inspect: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.inspect.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        get: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.get.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        getReceipt: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.getReceipt.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        list: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.list.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        create: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.create.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        ingest: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.ingest.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        update: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.update.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        remove: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.remove.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        reindex: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.reindex.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        search: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.search.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        readContext: (r) =>
          bind(r, (input, signal) =>
            bundle.workflows.readContext.run({ input, ...(signal === undefined ? {} : { signal }) })
          ),
        replay: (r) => {
          const memoryId = scopedAgentMemoryId(
            'direct',
            r.namespace.agentId,
            r.input.input.memoryId
          );
          return {
            memoryId,
            invoke: (signal) =>
              replayRetrievalMutation(
                resources.backend,
                parseMutation(r.input.operation, { ...r.input.input, memoryId }),
                signal
              ),
          };
        },
      },
    },
  };
  return { namespace: { port: namespace }, ...context };
}
