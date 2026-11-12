import {
  scopedAgentMemoryId,
  type ContextMemoryManagementCapability,
  type ManagedAgentNamespacePort,
  type MemoryProvisioningRequest,
} from '@print-an-agent/base-composition';
import {
  createContextMemoryBundle,
  createContextMemoryResources,
  createContextMemoryStateResources,
  type DeterministicMemoryMutation,
  type MemoryMutationResources,
  type MemoryWorkflowDefinitions,
} from '@print-an-agent/context-memory';

/** A second application's direct provisioning recipe; resources are caller-owned, no Registry. */
export function projectContextMemory<N>(
  namespace: ManagedAgentNamespacePort<N>,
  resources: MemoryMutationResources,
  workflows?: Partial<MemoryWorkflowDefinitions>
) {
  const bundle = createContextMemoryBundle({
    resources: createContextMemoryResources(resources),
    ...(workflows ? { workflows } : {}),
  });
  const state = createContextMemoryStateResources(resources.store);
  function bind<I extends { readonly memoryId: string }, O>(
    request: MemoryProvisioningRequest<N, I>,
    execute: (input: I, signal?: AbortSignal) => Promise<O>
  ) {
    const memoryId = scopedAgentMemoryId(
      'project-consumer',
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
      inspect: (r) =>
        bind(r, (input, signal) =>
          bundle.workflows.inspect.run({ input, ...(signal ? { signal } : {}) })
        ),
      getReceipt: (r) =>
        bind(r, (input, signal) =>
          bundle.workflows.getReceipt.run({ input, ...(signal ? { signal } : {}) })
        ),
      readContext: (r) =>
        bind(r, (input, signal) =>
          bundle.workflows.readContext.run({ input, ...(signal ? { signal } : {}) })
        ),
      create: (r) =>
        bind(r, (input, signal) =>
          bundle.workflows.create.run({ input, ...(signal ? { signal } : {}) })
        ),
      apply: (r) =>
        bind(r, (input, signal) =>
          bundle.workflows.apply.run({ input, ...(signal ? { signal } : {}) })
        ),
      configure: (r) =>
        bind(r, (input, signal) =>
          bundle.workflows.configure.run({ input, ...(signal ? { signal } : {}) })
        ),
      replay: (r) => {
        const memoryId = scopedAgentMemoryId(
          'project-consumer',
          r.namespace.agentId,
          r.input.input.memoryId
        );
        const mutation = r.input;
        const mapped: DeterministicMemoryMutation =
          mutation.operation === 'create'
            ? { operation: 'create', input: { ...mutation.input, memoryId } }
            : mutation.operation === 'apply'
              ? { operation: 'apply', input: { ...mutation.input, memoryId } }
              : { operation: 'configure', input: { ...mutation.input, memoryId } };
        return { memoryId, invoke: (signal) => state.memory.replay(mapped, signal) };
      },
    },
  };
  return { namespace: { port: namespace }, contextMemoryManagement };
}
