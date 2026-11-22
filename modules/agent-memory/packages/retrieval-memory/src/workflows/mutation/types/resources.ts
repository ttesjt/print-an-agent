import type { MutationOperation } from '../../../mutation-operations.js';
import type { RetrievalMutationOperations } from '../../../mutations/index.js';
import type { RetrievalExecutionPolicy } from '../../shared/index.js';

export interface RetrievalMutationResources<K extends MutationOperation> {
  readonly execution?: RetrievalExecutionPolicy;
  readonly mutations: RetrievalMutationOperations<K>;
}
