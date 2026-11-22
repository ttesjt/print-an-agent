import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import {
  createRetrievalInspectDefinition,
  createRetrievalGetDefinition,
  createRetrievalReceiptDefinition,
  createRetrievalListDefinition,
} from '../query/index.js';
import { createRetrievalRemoveDefinition } from '../mutation/index.js';
import { createRetrievalContentResources } from './create-resources.js';
import type {
  RetrievalContentResources,
  RetrievalContentWorkflowDefinitions,
  RetrievalContentBundleOptions,
} from './types.js';

/**
 * Independent content workflows share native definitions and need only a borrowed backend.
 * Project the public return shapes so consumer declarations do not need private type paths.
 */
export function createRetrievalContentBundle(
  options: RetrievalContentBundleOptions
): WorkflowBundle<
  { [K in keyof RetrievalContentResources]: RetrievalContentResources[K] },
  { [K in keyof RetrievalContentWorkflowDefinitions]: RetrievalContentWorkflowDefinitions[K] }
> {
  return new WorkflowBundle({
    resources: createRetrievalContentResources(options),
    workflows: {
      inspect: options.workflows?.inspect ?? createRetrievalInspectDefinition(),
      get: options.workflows?.get ?? createRetrievalGetDefinition(),
      getReceipt: options.workflows?.getReceipt ?? createRetrievalReceiptDefinition(),
      list: options.workflows?.list ?? createRetrievalListDefinition(),
      remove: options.workflows?.remove ?? createRetrievalRemoveDefinition(),
    },
  });
}
