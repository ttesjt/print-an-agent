import type { RetrievalSearchResources } from './search/index.js';
import type { RetrievalContentQueryResources } from './content/index.js';
import type { RetrievalQueryOperations } from './types.js';
import { defineRetrievalPolicy } from '../policy/index.js';
import type { RetrievalPolicy } from '../policy/index.js';
import { createContentQueries } from './content/index.js';
import { createSearchQueries } from './search/index.js';

/** Preserve the public narrow projection while its implementation owns only Content operations. */
export function createRetrievalContentQueries(
  resources: RetrievalContentQueryResources,
  options: Partial<RetrievalPolicy> = {}
): Pick<RetrievalQueryOperations, 'inspect' | 'get' | 'getReceipt' | 'list'> {
  return createContentQueries(resources, options);
}

export function createRetrievalQueries(
  resources: RetrievalSearchResources,
  options: Partial<RetrievalPolicy> = {}
): RetrievalQueryOperations {
  const policy = defineRetrievalPolicy(options);
  return { ...createContentQueries(resources, policy), ...createSearchQueries(resources, policy) };
}
