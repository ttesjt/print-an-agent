import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import type { MemoryHistoryStore, ReadMemoryVersionContextInput } from '../history/index.js';
import { readMemoryVersionContext } from '../history/index.js';
import type { MemoryMutationResources } from '../mutations/index.js';
import { createContextMemoryResources } from './resources.js';
import { memoryWorkflowDefinitions } from './bundle.js';
import { createContextMemoryHistoryResources } from './history.js';
import { memoryHistoryDefinitions } from './history/definitions.js';
import type { VersionedMemoryWorkflowResources } from './versioned/types/resources.js';
import type { VersionedMemoryWorkflowDefinitions } from './versioned/types/definitions.js';
import { createMemoryReadVersionContextDefinition } from './versioned/read-context-definition.js';

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
