import type {
  ContextMemoryManagementCapability,
  MemoryManagementOptions,
  MemoryProvisioningRequest,
} from '@print-an-agent/base-composition';
import { scopedAgentMemoryId } from '@print-an-agent/base-composition';
import {
  createContextMemoryBundle,
  createContextMemoryResources,
  createContextMemoryStateBundle,
  createContextMemoryStateResources,
  MemoryMeter,
  resolveMemoryConfig,
  type ApplyMemoryInput,
  type ConfigureMemoryInput,
  type CreateMemoryInput,
  type ReadContextInput,
  type DeterministicMemoryMutation,
} from '@print-an-agent/context-memory';
import type { ResourceRegistry } from '@print-an-agent/base-composition/resource-registry';
import type { MemoryManagementRecipe } from './recipe.js';
import { DEFAULT_MEMORY_MEASUREMENT_REF } from './recipe.js';
import type { StandaloneMemoryManagementOptions } from './contracts.js';
import { resolveMemoryResource } from './resolve.js';

export interface MemoryProfileAllocation {
  readonly registry: ResourceRegistry;
  readonly recipe: MemoryManagementRecipe;
}
export type MemoryAllocationResolver<N> = (
  namespace: MemoryProvisioningRequest<N, unknown>['namespace']
) => Promise<MemoryProfileAllocation>;

/** Profile-specific resource Service: Registry stays here, not in generic Services or Workflows. */
export function contextMemoryProvisioning<N>(
  options: StandaloneMemoryManagementOptions,
  allocation: MemoryAllocationResolver<N>
): ContextMemoryManagementCapability<N>['contextMemoryManagement'] {
  const config = options.context ?? {};
  const defaults = { measurementRef: DEFAULT_MEMORY_MEASUREMENT_REF, ...config.defaults };
  async function state<I extends { readonly memoryId: string }>(
    request: MemoryProvisioningRequest<N, I>,
    call?: MemoryManagementOptions
  ) {
    const { registry, recipe } = await allocation(request.namespace);
    const memoryId = scopedAgentMemoryId(
      options.storageNamespaceId,
      request.namespace.agentId,
      request.input.memoryId
    );
    const store = await resolveMemoryResource(
      'context',
      registry,
      recipe.store.request('authority'),
      call
    );
    const resources = createContextMemoryStateResources(store);
    const input = { ...request.input, memoryId };
    return {
      registry,
      recipe,
      memoryId,
      store,
      input,
      resources,
      bundle: createContextMemoryStateBundle({
        resources,
        ...(config.workflows === undefined ? {} : { workflows: config.workflows }),
      }),
    };
  }
  async function measured<
    I extends CreateMemoryInput | ApplyMemoryInput | ConfigureMemoryInput | ReadContextInput,
  >(
    request: MemoryProvisioningRequest<N, I>,
    operation: 'create' | 'apply' | 'configure' | 'readContext',
    call?: MemoryManagementOptions
  ) {
    const value = await state(request, call);
    const base =
      operation === 'create'
        ? defaults
        : (await value.resources.memory.inspect({ memoryId: value.memoryId }, call?.signal)).config;
    const selected =
      operation === 'create' || operation === 'configure'
        ? resolveMemoryConfig('config' in request.input ? request.input.config : {}, base)
            .measurementRef
        : operation === 'readContext' &&
            'measurementRef' in request.input &&
            request.input.measurementRef !== undefined
          ? request.input.measurementRef
          : base.measurementRef;
    const counter = await resolveMemoryResource(
      'context',
      value.registry,
      value.recipe.counter.request(selected),
      call
    );
    const bundle = createContextMemoryBundle({
      resources: createContextMemoryResources({
        store: value.store,
        meter: new MemoryMeter({ counter }),
        defaults,
      }),
      ...(config.workflows === undefined ? {} : { workflows: config.workflows }),
    });
    return { ...value, bundle };
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
      replay: async (request, call) => {
        const s = await state({ namespace: request.namespace, input: request.input.input }, call);
        const mutation = request.input;
        const bound: DeterministicMemoryMutation =
          mutation.operation === 'create'
            ? { operation: mutation.operation, input: { ...mutation.input, memoryId: s.memoryId } }
            : mutation.operation === 'apply'
              ? {
                  operation: mutation.operation,
                  input: { ...mutation.input, memoryId: s.memoryId },
                }
              : {
                  operation: mutation.operation,
                  input: { ...mutation.input, memoryId: s.memoryId },
                };
        // Preserve the original request fields and native digest; no provisioning defaults inserted.
        return {
          memoryId: s.memoryId,
          invoke: (signal) => s.resources.memory.replay(bound, signal),
        };
      },
      create: async (request, call) => {
        const s = await measured(request, 'create', call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.create.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      apply: async (request, call) => {
        const s = await measured(request, 'apply', call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.apply.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      configure: async (request, call) => {
        const s = await measured(request, 'configure', call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.configure.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
      readContext: async (request, call) => {
        const s = await measured(request, 'readContext', call);
        return {
          memoryId: s.memoryId,
          invoke: (signal) =>
            s.bundle.workflows.readContext.run({
              input: s.input,
              ...(signal === undefined ? {} : { signal }),
            }),
        };
      },
    },
  };
}
