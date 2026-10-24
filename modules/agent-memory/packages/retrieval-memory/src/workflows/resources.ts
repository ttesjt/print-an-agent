import type { RetrievalPolicy } from '../config.js';
import type { RetrievalContextOptions } from '../contracts/context.js';
import { createRetrievalContext, type RetrievalContextOperations } from '../context/operations.js';
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
/** Pure assembly, no I/O and no transferred resource ownership. */
export function createRetrievalWorkflowResources(
  resources: RetrievalResources,
  options: RetrievalWorkflowResourceOptions = {}
): RetrievalWorkflowResources {
  const policy = options.policy ?? {};
  const queries = createRetrievalQueries(resources, policy);
  return Object.freeze({
    context: createRetrievalContext(queries, options.context, policy),
    execution: defineRetrievalExecutionPolicy(
      options.execution ?? DEFAULT_RETRIEVAL_EXECUTION_POLICY
    ),
    mutations: createRetrievalMutations(resources, policy),
    queries,
  });
}
