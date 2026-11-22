import type { RetrievalBackend } from '../../persistence/index.js';
import type { RetrievalPolicy } from '../../policy/index.js';
import type { RetrievalQueryOperations } from '../../queries/index.js';
import type { RetrievalMutationOperations } from '../../mutations/index.js';
import type { RetrievalExecutionPolicy } from '../shared/index.js';
import type {
  createRetrievalInspectDefinition,
  createRetrievalGetDefinition,
  createRetrievalReceiptDefinition,
  createRetrievalListDefinition,
} from '../query/index.js';
import type { createRetrievalRemoveDefinition } from '../mutation/index.js';

export interface RetrievalContentResources {
  readonly queries: Pick<RetrievalQueryOperations, 'inspect' | 'get' | 'getReceipt' | 'list'>;
  readonly mutations: RetrievalMutationOperations<'remove'>;
  readonly execution?: RetrievalExecutionPolicy;
}

export interface RetrievalContentResourceOptions {
  readonly backend: RetrievalBackend;
  readonly policy?: Partial<RetrievalPolicy>;
  readonly execution?: RetrievalExecutionPolicy;
}

export interface RetrievalContentWorkflowDefinitions {
  readonly inspect: ReturnType<typeof createRetrievalInspectDefinition>;
  readonly get: ReturnType<typeof createRetrievalGetDefinition>;
  readonly getReceipt: ReturnType<typeof createRetrievalReceiptDefinition>;
  readonly list: ReturnType<typeof createRetrievalListDefinition>;
  readonly remove: ReturnType<typeof createRetrievalRemoveDefinition>;
}

export interface RetrievalContentBundleOptions extends RetrievalContentResourceOptions {
  /** Preserve incremental configuration without making the internal definition catalog mutable. */
  readonly workflows?: {
    -readonly [K in keyof RetrievalContentWorkflowDefinitions]?: RetrievalContentWorkflowDefinitions[K];
  };
}
