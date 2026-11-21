import type { ContextMemoryManagementCapability } from '@print-an-agent/base-composition';
import type { DeterministicMemoryMutation } from '@print-an-agent/context-memory';
import type { MemoryAllocationResolver } from '../types/allocation.js';
import type { StandaloneMemoryManagementOptions } from '../types/options.js';
import { createContextMemoryResourceResolvers } from './resources.js';

/** Profile-specific resource Service: Registry stays here, not in generic Services or Workflows. */
export function contextMemoryProvisioning<N>(
  options: StandaloneMemoryManagementOptions,
  allocation: MemoryAllocationResolver<N>
): ContextMemoryManagementCapability<N>['contextMemoryManagement'] {
  const { state, measured } = createContextMemoryResourceResolvers(options, allocation);
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
