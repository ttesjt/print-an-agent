import type { RetrievalPolicy } from '../config.js';
import {
  createRetrievalMutations,
  type RetrievalResources,
  type RetrievalMutationOperations,
} from '../domain/mutations.js';
import { createRetrievalQueries, type RetrievalQueryOperations } from '../domain/queries.js';
import {
  defineRetrievalExecutionPolicy,
  DEFAULT_RETRIEVAL_EXECUTION_POLICY,
  type RetrievalExecutionPolicy,
} from './execution.js';
export interface RetrievalWorkflowResources {
  readonly execution?: RetrievalExecutionPolicy;
  readonly mutations: RetrievalMutationOperations;
  readonly queries: RetrievalQueryOperations;
}
/** Pure assembly, no I/O and no transferred resource ownership. */
export function createRetrievalWorkflowResources(
  resources: RetrievalResources,
  policy: Partial<RetrievalPolicy> = {},
  execution: RetrievalExecutionPolicy = DEFAULT_RETRIEVAL_EXECUTION_POLICY
): RetrievalWorkflowResources {
  return Object.freeze({
    execution: defineRetrievalExecutionPolicy(execution),
    mutations: createRetrievalMutations(resources, policy),
    queries: createRetrievalQueries(resources, policy),
  });
}
