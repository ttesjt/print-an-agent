import { WorkflowBundle } from '@ta-agent/workflow-bundle';
import {
  createMemoryCreateDefinition,
  createMemoryApplyDefinition,
  createMemoryConfigureDefinition,
  createMemoryReadContextDefinition,
  createMemoryGetReceiptDefinition,
  createMemoryInspectDefinition,
  createMemoryObserveDefinition,
  createMemoryEditDefinition,
  createMemoryCompactDefinition,
  type ModelMemoryResources,
  type ModelMemoryWorkflowDefinitions,
} from '@ta-agent/context-memory';

/** Entire native Bundle graph supplied by this consumer, not a Registry runner or wrapper. */
export function customContextBundle(
  resources: ModelMemoryResources,
  edit: ModelMemoryWorkflowDefinitions['edit'] = createMemoryEditDefinition()
) {
  const workflows: ModelMemoryWorkflowDefinitions = {
    inspect: createMemoryInspectDefinition(),
    create: createMemoryCreateDefinition(),
    apply: createMemoryApplyDefinition(),
    configure: createMemoryConfigureDefinition(),
    readContext: createMemoryReadContextDefinition(),
    getReceipt: createMemoryGetReceiptDefinition(),
    observe: createMemoryObserveDefinition(),
    edit,
    compact: createMemoryCompactDefinition(),
  };
  return new WorkflowBundle({ resources, workflows });
}
