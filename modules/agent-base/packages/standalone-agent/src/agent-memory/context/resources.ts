import type {
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
} from '@print-an-agent/context-memory';
import { DEFAULT_MEMORY_MEASUREMENT_REF } from '../provisioning/recipe.js';
import { resolveMemoryResource } from '../provisioning/resolve-resource.js';
import type { MemoryAllocationResolver } from '../types/allocation.js';
import type { StandaloneMemoryManagementOptions } from '../types/options.js';
import type {
  ContextMemoryResourceResolvers,
  ContextMemoryState,
  MeasuredContextMemory,
} from './types.js';

export function createContextMemoryResourceResolvers<N>(
  options: StandaloneMemoryManagementOptions,
  allocation: MemoryAllocationResolver<N>
): ContextMemoryResourceResolvers<N> {
  const config = options.context ?? {};
  const defaults = { measurementRef: DEFAULT_MEMORY_MEASUREMENT_REF, ...config.defaults };
  async function state<I extends { readonly memoryId: string }>(
    request: MemoryProvisioningRequest<N, I>,
    call?: MemoryManagementOptions
  ): Promise<ContextMemoryState<I>> {
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
  ): Promise<MeasuredContextMemory<I>> {
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

  return { state, measured };
}
