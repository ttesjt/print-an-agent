import type { RetrievalSearchResources } from './types/resources.js';
import type { RetrievalPolicy } from '../../policy/index.js';
import { assertNotAborted } from '../../errors.js';
import { requireSpace } from '../../persistence/index.js';
import { parseSearchInput } from './input.js';
import { parseSearchResult } from './results.js';
import { embedTexts } from '../../representation/index.js';
import type { RetrievalSearchOperations } from './types/operations.js';

export function createSearchQueries(
  resources: RetrievalSearchResources,
  policy: RetrievalPolicy
): RetrievalSearchOperations {
  return {
    async search(value, signal) {
      const input = parseSearchInput(value, policy);
      const space = await requireSpace(resources.backend, input.memoryId, signal);
      const vectors = await embedTexts(
        resources.embeddings,
        space,
        [input.query],
        'query',
        policy,
        signal
      );
      assertNotAborted(signal);
      const result = await resources.backend.search(
        {
          space,
          vector: vectors[0]!,
          topK: input.topK,
          ...(input.filter === undefined ? {} : { filter: input.filter }),
        },
        signal
      );
      assertNotAborted(signal);
      return parseSearchResult(result, space, input.topK);
    },
  };
}
