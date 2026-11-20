import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import type { MemoryHistoryStore, ReadMemoryVersionContextInput } from '../contracts/history.js';
import type { ReadContextResult } from '../contracts/inputs.js';
import { readMemoryVersionContext } from '../domain/read-version-context.js';
import { memoryDefinition, type MemoryWorkflowOptions } from './definition.js';
import type { MemoryMutationResources } from '../domain/mutations.js';
import { createContextMemoryResources, type MemoryOperations } from './resources.js';
import { memoryWorkflowDefinitions, type MemoryWorkflowDefinitions } from './bundle.js';
import {
  createContextMemoryHistoryResources,
  memoryHistoryDefinitions,
  type MemoryHistoryOperations,
  type MemoryHistoryWorkflowDefinitions,
} from './history.js';

export interface VersionedMemoryOperations extends MemoryOperations, MemoryHistoryOperations {
  readVersionContext(
    input: ReadMemoryVersionContextInput,
    signal?: AbortSignal
  ): Promise<ReadContextResult>;
}
export interface VersionedMemoryWorkflowResources {
  readonly memory: VersionedMemoryOperations;
}
export type VersionedMemoryWorkflowDefinitions = MemoryWorkflowDefinitions &
  MemoryHistoryWorkflowDefinitions & {
    readonly readVersionContext: ReturnType<typeof createMemoryReadVersionContextDefinition>;
  };
export function createMemoryReadVersionContextDefinition(
  options: MemoryWorkflowOptions<
    ReadMemoryVersionContextInput,
    ReadContextResult | undefined,
    'readVersionContext',
    VersionedMemoryOperations
  > = {}
) {
  return memoryDefinition<
    ReadMemoryVersionContextInput,
    ReadContextResult | undefined,
    'readVersionContext',
    VersionedMemoryOperations
  >(
    'context-memory.read-version-context',
    () => undefined,
    (resources, input, signal) => resources.memory.readVersionContext(input, signal),
    options
  );
}
/** Explicit opt-in. Current-only adapters and management consumers keep their narrow capability. */
export function createVersionedContextMemoryResources(
  options: MemoryMutationResources & { readonly store: MemoryHistoryStore }
): VersionedMemoryWorkflowResources {
  return Object.freeze({
    memory: Object.freeze({
      ...createContextMemoryResources(options).memory,
      ...createContextMemoryHistoryResources(options.store).memory,
      readVersionContext: (input: ReadMemoryVersionContextInput, signal?: AbortSignal) =>
        readMemoryVersionContext(options, input, signal),
    }),
  });
}
export function createVersionedContextMemoryBundle(options: {
  readonly resources: VersionedMemoryWorkflowResources;
  readonly workflows?: Partial<VersionedMemoryWorkflowDefinitions>;
}) {
  return new WorkflowBundle({
    resources: options.resources,
    workflows: {
      ...memoryWorkflowDefinitions(),
      ...memoryHistoryDefinitions(),
      readVersionContext: createMemoryReadVersionContextDefinition(),
      ...options.workflows,
    },
  });
}
