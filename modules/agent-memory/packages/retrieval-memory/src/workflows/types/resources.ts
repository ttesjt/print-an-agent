import type { RetrievalPolicy } from '../../policy/index.js';
import type { RetrievalContextOptions, RetrievalContextOperations } from '../../context/index.js';
import type { RetrievalMutationOperations } from '../../mutations/index.js';
import type { RetrievalQueryOperations } from '../../queries/index.js';
import type { RetrievalExecutionPolicy } from '../shared/index.js';

export interface RetrievalWorkflowResources {
  readonly context: RetrievalContextOperations;
  readonly execution?: RetrievalExecutionPolicy;
  readonly mutations: RetrievalMutationOperations;
  readonly queries: RetrievalQueryOperations;
}

export interface RetrievalWorkflowResourceOptions {
  readonly policy?: Partial<RetrievalPolicy>;
  readonly execution?: RetrievalExecutionPolicy;
  readonly context?: RetrievalContextOptions;
}
