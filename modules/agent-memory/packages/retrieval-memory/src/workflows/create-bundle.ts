import type { RetrievalWorkflowResources } from './types/resources.js';
import type { RetrievalWorkflowDefinitions, RetrievalBundleOptions } from './types/bundle.js';
import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import {
  createRetrievalCreateDefinition,
  createRetrievalIngestDefinition,
  createRetrievalReindexDefinition,
  createRetrievalRemoveDefinition,
  createRetrievalUpdateDefinition,
} from './mutation/index.js';
import {
  createRetrievalGetDefinition,
  createRetrievalInspectDefinition,
  createRetrievalListDefinition,
  createRetrievalReceiptDefinition,
  createRetrievalSearchDefinition,
} from './query/index.js';
import { createRetrievalReadContextDefinition } from './context/index.js';

export function createRetrievalMemoryBundle(
  options: RetrievalBundleOptions
): WorkflowBundle<RetrievalWorkflowResources, RetrievalWorkflowDefinitions> {
  return new WorkflowBundle({
    resources: options.resources,
    workflows: {
      readContext: options.workflows?.readContext ?? createRetrievalReadContextDefinition(),
      reindex: options.workflows?.reindex ?? createRetrievalReindexDefinition(),
      create: options.workflows?.create ?? createRetrievalCreateDefinition(),
      ingest: options.workflows?.ingest ?? createRetrievalIngestDefinition(),
      update: options.workflows?.update ?? createRetrievalUpdateDefinition(),
      remove: options.workflows?.remove ?? createRetrievalRemoveDefinition(),
      inspect: options.workflows?.inspect ?? createRetrievalInspectDefinition(),
      get: options.workflows?.get ?? createRetrievalGetDefinition(),
      getReceipt: options.workflows?.getReceipt ?? createRetrievalReceiptDefinition(),
      list: options.workflows?.list ?? createRetrievalListDefinition(),
      search: options.workflows?.search ?? createRetrievalSearchDefinition(),
    },
  });
}
