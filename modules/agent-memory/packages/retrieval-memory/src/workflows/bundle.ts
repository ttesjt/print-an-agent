import { WorkflowBundle } from '@print-an-agent/workflow-bundle';
import * as definitions from './definitions.js';
import type { RetrievalWorkflowResources } from './resources.js';
import { createRetrievalReadContextDefinition } from './context.js';
export interface RetrievalWorkflowDefinitions {
  readonly readContext: ReturnType<typeof createRetrievalReadContextDefinition>;
  readonly reindex: ReturnType<typeof definitions.createRetrievalReindexDefinition>;
  readonly create: ReturnType<typeof definitions.createRetrievalCreateDefinition>;
  readonly ingest: ReturnType<typeof definitions.createRetrievalIngestDefinition>;
  readonly update: ReturnType<typeof definitions.createRetrievalUpdateDefinition>;
  readonly remove: ReturnType<typeof definitions.createRetrievalRemoveDefinition>;
  readonly inspect: ReturnType<typeof definitions.createRetrievalInspectDefinition>;
  readonly get: ReturnType<typeof definitions.createRetrievalGetDefinition>;
  readonly getReceipt: ReturnType<typeof definitions.createRetrievalReceiptDefinition>;
  readonly list: ReturnType<typeof definitions.createRetrievalListDefinition>;
  readonly search: ReturnType<typeof definitions.createRetrievalSearchDefinition>;
}
export interface RetrievalBundleOptions {
  readonly resources: RetrievalWorkflowResources;
  readonly workflows?: Partial<RetrievalWorkflowDefinitions>;
}
export function createRetrievalMemoryBundle(options: RetrievalBundleOptions) {
  return new WorkflowBundle({
    resources: options.resources,
    workflows: {
      readContext: options.workflows?.readContext ?? createRetrievalReadContextDefinition(),
      reindex: options.workflows?.reindex ?? definitions.createRetrievalReindexDefinition(),
      create: options.workflows?.create ?? definitions.createRetrievalCreateDefinition(),
      ingest: options.workflows?.ingest ?? definitions.createRetrievalIngestDefinition(),
      update: options.workflows?.update ?? definitions.createRetrievalUpdateDefinition(),
      remove: options.workflows?.remove ?? definitions.createRetrievalRemoveDefinition(),
      inspect: options.workflows?.inspect ?? definitions.createRetrievalInspectDefinition(),
      get: options.workflows?.get ?? definitions.createRetrievalGetDefinition(),
      getReceipt: options.workflows?.getReceipt ?? definitions.createRetrievalReceiptDefinition(),
      list: options.workflows?.list ?? definitions.createRetrievalListDefinition(),
      search: options.workflows?.search ?? definitions.createRetrievalSearchDefinition(),
    },
  });
}
