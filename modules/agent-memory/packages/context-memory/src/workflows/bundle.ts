import { WorkflowBundle } from '@ta-agent/workflow-bundle';
import {
  createMemoryCreateDefinition,
  createMemoryApplyDefinition,
  createMemoryConfigureDefinition,
  createMemoryReadContextDefinition,
  createMemoryGetReceiptDefinition,
  createMemoryInspectDefinition,
} from './deterministic.js';
import type { MemoryWorkflowResources } from './resources.js';
import type { ModelMemoryResources } from './model-resources.js';
import {
  createMemoryObserveDefinition,
  createMemoryEditDefinition,
  createMemoryCompactDefinition,
} from './model-definition.js';

export interface MemoryWorkflowDefinitions {
  readonly inspect: ReturnType<typeof createMemoryInspectDefinition>;
  readonly create: ReturnType<typeof createMemoryCreateDefinition>;
  readonly apply: ReturnType<typeof createMemoryApplyDefinition>;
  readonly configure: ReturnType<typeof createMemoryConfigureDefinition>;
  readonly readContext: ReturnType<typeof createMemoryReadContextDefinition>;
  readonly getReceipt: ReturnType<typeof createMemoryGetReceiptDefinition>;
}
export interface ContextMemoryBundleOptions {
  readonly resources: MemoryWorkflowResources;
  readonly workflows?: Partial<MemoryWorkflowDefinitions>;
}
export function createContextMemoryStateBundle(options: {
  readonly resources: MemoryWorkflowResources<'inspect' | 'getReceipt' | 'replay'>;
  readonly workflows?: Partial<Pick<MemoryWorkflowDefinitions, 'inspect' | 'getReceipt'>>;
}) {
  return new WorkflowBundle({
    resources: options.resources,
    workflows: {
      inspect: options.workflows?.inspect ?? createMemoryInspectDefinition(),
      getReceipt: options.workflows?.getReceipt ?? createMemoryGetReceiptDefinition(),
    },
  });
}
export interface ModelMemoryWorkflowDefinitions extends MemoryWorkflowDefinitions {
  readonly observe: ReturnType<typeof createMemoryObserveDefinition>;
  readonly edit: ReturnType<typeof createMemoryEditDefinition>;
  readonly compact: ReturnType<typeof createMemoryCompactDefinition>;
}
export interface ModelContextMemoryBundleOptions {
  readonly resources: ModelMemoryResources;
  readonly workflows?: Partial<ModelMemoryWorkflowDefinitions>;
}
function modelOptions(
  options: ContextMemoryBundleOptions | ModelContextMemoryBundleOptions
): options is ModelContextMemoryBundleOptions {
  return 'updates' in options.resources && 'planner' in options.resources;
}
export function createContextMemoryBundle(
  options: ModelContextMemoryBundleOptions
): WorkflowBundle<ModelMemoryResources, ModelMemoryWorkflowDefinitions>;
export function createContextMemoryBundle(
  options: ContextMemoryBundleOptions
): WorkflowBundle<MemoryWorkflowResources, MemoryWorkflowDefinitions>;
export function createContextMemoryBundle(
  options: ContextMemoryBundleOptions | ModelContextMemoryBundleOptions
) {
  if (modelOptions(options))
    return new WorkflowBundle({
      resources: options.resources,
      workflows: {
        inspect: options.workflows?.inspect ?? createMemoryInspectDefinition(),
        create: options.workflows?.create ?? createMemoryCreateDefinition(),
        apply: options.workflows?.apply ?? createMemoryApplyDefinition(),
        configure: options.workflows?.configure ?? createMemoryConfigureDefinition(),
        readContext: options.workflows?.readContext ?? createMemoryReadContextDefinition(),
        getReceipt: options.workflows?.getReceipt ?? createMemoryGetReceiptDefinition(),
        observe: options.workflows?.observe ?? createMemoryObserveDefinition(),
        edit: options.workflows?.edit ?? createMemoryEditDefinition(),
        compact: options.workflows?.compact ?? createMemoryCompactDefinition(),
      },
    });
  return new WorkflowBundle({
    resources: options.resources,
    workflows: {
      inspect: options.workflows?.inspect ?? createMemoryInspectDefinition(),
      create: options.workflows?.create ?? createMemoryCreateDefinition(),
      apply: options.workflows?.apply ?? createMemoryApplyDefinition(),
      configure: options.workflows?.configure ?? createMemoryConfigureDefinition(),
      readContext: options.workflows?.readContext ?? createMemoryReadContextDefinition(),
      getReceipt: options.workflows?.getReceipt ?? createMemoryGetReceiptDefinition(),
    },
  });
}
