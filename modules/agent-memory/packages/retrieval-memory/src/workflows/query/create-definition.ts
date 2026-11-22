import { createQueryStepDefinitions } from './step-definitions.js';
import {
  createSkippedRetrievalResult,
  preserveRetrievalCommit,
  retrievalExecutor,
  retrievalLifecycle,
} from '../shared/index.js';
import type { RetrievalQueryResources } from './types/resources.js';
import type { RetrievalQueryOperations } from '../../queries/index.js';
import type { RetrievalReceipt } from '../../types/publication.js';
import { RetrievalMemoryError } from '../../errors.js';
import type { RetrievalQueryDefinition, RetrievalQueryOptions } from './types/workflow.js';

export function createRetrievalQueryDefinition<
  I,
  O,
  K extends keyof RetrievalQueryOperations = keyof RetrievalQueryOperations,
>(
  name: string,
  execute: (resources: RetrievalQueryResources<K>, input: I, signal: AbortSignal) => Promise<O>,
  options: RetrievalQueryOptions<I, O, K> = {},
  receipt?: (value: O) => RetrievalReceipt | undefined
): RetrievalQueryDefinition<I, O, K> {
  return {
    ...options,
    name: `retrieval-memory:${name}`,
    entryStep: 'runOperation',
    createState: ({ input }) => ({ input }),
    createSkippedResult: createSkippedRetrievalResult,
    createResult(state) {
      if (state.outcome === undefined)
        throw preserveRetrievalCommit(
          new RetrievalMemoryError('SEARCH_FAILED', 'Retrieval query completed without an output.'),
          state
        );
      return state.outcome;
    },
    ...(receipt === undefined
      ? {}
      : {
          executeStep: retrievalExecutor(options.executeStep),
          lifecycle: retrievalLifecycle(options.lifecycle),
        }),
    stepDefinitions: createQueryStepDefinitions<I, O, K>(execute, receipt),
  };
}
