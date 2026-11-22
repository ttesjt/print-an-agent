import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import {
  createRetrievalCreateDefinition,
  createRetrievalGetDefinition,
  createRetrievalIngestDefinition,
  createRetrievalInspectDefinition,
  createRetrievalListDefinition,
  createRetrievalReceiptDefinition,
  createRetrievalReindexDefinition,
  createRetrievalRemoveDefinition,
  createRetrievalSearchDefinition,
  createRetrievalUpdateDefinition,
} from './definitions.js';
import { createRetrievalReadContextDefinition } from './context.js';
import type { RetrievalBundleOptions } from './types/bundle.js';

export function createRetrievalMemoryBundle(options: RetrievalBundleOptions) {
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
