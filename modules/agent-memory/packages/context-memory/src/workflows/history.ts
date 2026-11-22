import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import type {
  ForkMemoryInput,
  ListMemoryVersionsInput,
  MemoryHistoryStore,
  MemoryVersionReference,
} from '../history/index.js';
import { inspectMemoryVersion, listMemoryVersions, forkMemory } from '../history/index.js';
import { createContextMemoryStateResources } from './state-resources.js';
import { createMemoryGetReceiptDefinition } from './deterministic.js';
import type { MemoryHistoryWorkflowResources } from './history/types/operations.js';
import type { MemoryHistoryWorkflowDefinitions } from './history/types/definitions.js';
import { memoryHistoryDefinitions } from './history/definitions.js';

export function createContextMemoryHistoryResources(
  store: MemoryHistoryStore
): MemoryHistoryWorkflowResources {
  const memory = createContextMemoryStateResources(store).memory;
  return Object.freeze({
    memory: Object.freeze({
      getReceipt: memory.getReceipt.bind(memory),
      inspectVersion: (input: MemoryVersionReference, signal?: AbortSignal) =>
        inspectMemoryVersion(store, input, signal),
      listVersions: (input: ListMemoryVersionsInput, signal?: AbortSignal) =>
        listMemoryVersions(store, input, signal),
      fork: (input: ForkMemoryInput, signal?: AbortSignal) => forkMemory(store, input, signal),
    }),
  });
}

/** Narrow state-only installation: history and fork need no model, counter or renderer. */
export function createContextMemoryHistoryBundle(options: {
  readonly resources: MemoryHistoryWorkflowResources;
  readonly workflows?: Partial<
    MemoryHistoryWorkflowDefinitions & {
      readonly getReceipt: ReturnType<typeof createMemoryGetReceiptDefinition>;
    }
  >;
}) {
  return new WorkflowBundle({
    resources: options.resources,
    workflows: {
      ...memoryHistoryDefinitions(),
      getReceipt: createMemoryGetReceiptDefinition(),
      ...options.workflows,
    },
  });
}
