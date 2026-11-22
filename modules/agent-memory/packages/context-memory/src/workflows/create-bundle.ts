import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import type {
  MemoryWorkflowResources,
  MemoryWorkflowDefinitions,
  ContextMemoryBundleOptions,
} from './deterministic/index.js';
import type {
  ModelMemoryResources,
  ModelMemoryWorkflowDefinitions,
  ModelContextMemoryBundleOptions,
} from './model-driven/index.js';
import {
  createMemoryObserveDefinition,
  createMemoryEditDefinition,
  createMemoryCompactDefinition,
} from './model-driven/index.js';
import { memoryWorkflowDefinitions } from './deterministic/index.js';

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
        ...memoryWorkflowDefinitions(options.workflows),
        observe: options.workflows?.observe ?? createMemoryObserveDefinition(),
        edit: options.workflows?.edit ?? createMemoryEditDefinition(),
        compact: options.workflows?.compact ?? createMemoryCompactDefinition(),
      },
    });
  return new WorkflowBundle({
    resources: options.resources,
    workflows: {
      ...memoryWorkflowDefinitions(options.workflows),
    },
  });
}
