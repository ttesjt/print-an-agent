import type {
  createRetrievalCreateDefinition,
  createRetrievalIngestDefinition,
  createRetrievalReindexDefinition,
  createRetrievalRemoveDefinition,
  createRetrievalUpdateDefinition,
} from '../mutation/index.js';
import type {
  createRetrievalGetDefinition,
  createRetrievalInspectDefinition,
  createRetrievalListDefinition,
  createRetrievalReceiptDefinition,
  createRetrievalSearchDefinition,
} from '../query/index.js';
import type { RetrievalWorkflowResources } from './resources.js';
import type { createRetrievalReadContextDefinition } from '../context/index.js';

export interface RetrievalWorkflowDefinitions {
  readonly readContext: ReturnType<typeof createRetrievalReadContextDefinition>;
  readonly reindex: ReturnType<typeof createRetrievalReindexDefinition>;
  readonly create: ReturnType<typeof createRetrievalCreateDefinition>;
  readonly ingest: ReturnType<typeof createRetrievalIngestDefinition>;
  readonly update: ReturnType<typeof createRetrievalUpdateDefinition>;
  readonly remove: ReturnType<typeof createRetrievalRemoveDefinition>;
  readonly inspect: ReturnType<typeof createRetrievalInspectDefinition>;
  readonly get: ReturnType<typeof createRetrievalGetDefinition>;
  readonly getReceipt: ReturnType<typeof createRetrievalReceiptDefinition>;
  readonly list: ReturnType<typeof createRetrievalListDefinition>;
  readonly search: ReturnType<typeof createRetrievalSearchDefinition>;
}

export interface RetrievalBundleOptions {
  readonly resources: RetrievalWorkflowResources;
  readonly workflows?: Partial<RetrievalWorkflowDefinitions>;
}
