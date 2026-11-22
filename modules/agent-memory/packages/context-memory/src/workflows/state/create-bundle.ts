import type { MemoryStateResources } from './types.js';
import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import { createMemoryGetReceiptDefinition, createMemoryInspectDefinition } from './definitions.js';

export function createContextMemoryStateBundle(options: {
  readonly resources: MemoryStateResources;
  readonly workflows?: Partial<{
    readonly inspect: ReturnType<typeof createMemoryInspectDefinition>;
    readonly getReceipt: ReturnType<typeof createMemoryGetReceiptDefinition>;
  }>;
}) {
  return new WorkflowBundle({
    resources: options.resources,
    workflows: {
      inspect: options.workflows?.inspect ?? createMemoryInspectDefinition(),
      getReceipt: options.workflows?.getReceipt ?? createMemoryGetReceiptDefinition(),
    },
  });
}
