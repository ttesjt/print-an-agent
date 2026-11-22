import { createRetrievalContext } from '../context/index.js';
import { createRetrievalMutations } from '../mutations/index.js';
import type { RetrievalResources } from '../mutations/index.js';
import { createRetrievalQueries } from '../queries/index.js';
import { defineRetrievalExecutionPolicy, DEFAULT_RETRIEVAL_EXECUTION_POLICY } from './execution.js';
import type {
  RetrievalWorkflowResources,
  RetrievalWorkflowResourceOptions,
} from './types/resources.js';

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
