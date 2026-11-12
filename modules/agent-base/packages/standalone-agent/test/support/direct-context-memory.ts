import {
  scopedAgentMemoryId,
  type ContextMemoryManagementCapability,
  type ManagedAgentNamespacePort,
  type MemoryProvisioningRequest,
} from '@print-an-agent/base-composition';
import {
  createContextMemoryBundle,
  createContextMemoryResources,
  createContextMemoryStateBundle,
  createContextMemoryStateResources,
  MemoryMeter,
  type MemoryMutationResources,
  type MemoryWorkflowDefinitions,
  type DeterministicMemoryMutation,
} from '@print-an-agent/context-memory';

/** Independent direct provisioning consumer: no Registry, Profile Token, path lookup or second runner. */
export function directContextMemory<N>(
  namespace: ManagedAgentNamespacePort<N>,
  resources: MemoryMutationResources,
  workflows?: Partial<MemoryWorkflowDefinitions>
) {
  const full = createContextMemoryBundle({
    resources: createContextMemoryResources(resources),
    ...(workflows === undefined ? {} : { workflows }),
  });
  const state = createContextMemoryStateResources(resources.store);
  const queries = createContextMemoryStateBundle({
    resources: state,
    ...(workflows === undefined ? {} : { workflows }),
  });
  function bind<I extends { readonly memoryId: string }, O>(
    request: MemoryProvisioningRequest<N, I>,
    execute: (input: I, signal?: AbortSignal) => Promise<O>
  ) {
    const memoryId = scopedAgentMemoryId(
      'direct',
      request.namespace.agentId,
      request.input.memoryId
    );
    return {
      memoryId,
      invoke: (signal?: AbortSignal) => execute({ ...request.input, memoryId }, signal),
    };
  }
  const contextMemoryManagement: ContextMemoryManagementCapability<N>['contextMemoryManagement'] = {
    resolve: {
      inspect: (request) =>
        bind(request, (input, signal) =>
          queries.workflows.inspect.run({ input, ...(signal === undefined ? {} : { signal }) })
        ),
      getReceipt: (request) =>
        bind(request, (input, signal) =>
          queries.workflows.getReceipt.run({ input, ...(signal === undefined ? {} : { signal }) })
        ),
      readContext: (request) =>
        bind(request, (input, signal) =>
          full.workflows.readContext.run({ input, ...(signal === undefined ? {} : { signal }) })
        ),
      create: (request) =>
        bind(request, (input, signal) =>
          full.workflows.create.run({ input, ...(signal === undefined ? {} : { signal }) })
        ),
      apply: (request) =>
        bind(request, (input, signal) =>
          full.workflows.apply.run({ input, ...(signal === undefined ? {} : { signal }) })
        ),
      configure: (request) =>
        bind(request, (input, signal) =>
          full.workflows.configure.run({ input, ...(signal === undefined ? {} : { signal }) })
        ),
      replay: (request) => {
        const memoryId = scopedAgentMemoryId(
          'direct',
          request.namespace.agentId,
          request.input.input.memoryId
        );
        const m = request.input;
        const mutation: DeterministicMemoryMutation =
          m.operation === 'create'
            ? { operation: m.operation, input: { ...m.input, memoryId } }
            : m.operation === 'apply'
              ? { operation: m.operation, input: { ...m.input, memoryId } }
              : { operation: m.operation, input: { ...m.input, memoryId } };
        return { memoryId, invoke: (signal) => state.memory.replay(mutation, signal) };
      },
    },
  };
  return { namespace: { port: namespace }, contextMemoryManagement };
}

export function directMemoryResources(
  store: MemoryMutationResources['store'],
  counter: ConstructorParameters<typeof MemoryMeter>[0]['counter']
) {
  if (counter === undefined) throw new Error('Counter required');
  return {
    store,
    meter: new MemoryMeter({ counter }),
    defaults: { measurementRef: counter.descriptor.measurementRef },
  };
}
