import { createRetrievalContentQueries } from '../../queries/index.js';
import { createRetrievalStateMutations } from '../../mutations/index.js';
import type { RetrievalContentResources, RetrievalContentResourceOptions } from './types.js';

/** Bind backend-only capabilities without model placeholders or ownership transfer. */
export function createRetrievalContentResources(
  options: RetrievalContentResourceOptions
): RetrievalContentResources {
  return {
    queries: createRetrievalContentQueries(options, options.policy),
    mutations: createRetrievalStateMutations(options, options.policy),
    ...(options.execution === undefined ? {} : { execution: options.execution }),
  };
}
