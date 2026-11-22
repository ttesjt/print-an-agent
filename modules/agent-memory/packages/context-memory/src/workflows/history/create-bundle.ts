import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import { createMemoryGetReceiptDefinition } from '../state/index.js';
import type { MemoryHistoryWorkflowResources } from './types/operations.js';
import type { MemoryHistoryWorkflowDefinitions } from './types/definitions.js';
import { memoryHistoryDefinitions } from './definitions.js';

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
