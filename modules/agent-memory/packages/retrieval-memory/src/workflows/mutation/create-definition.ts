import { createMutationStepDefinitions } from './step-definitions.js';
import {
  createSkippedRetrievalResult,
  preserveRetrievalCommit,
  retrievalExecutor,
  retrievalLifecycle,
} from '../shared/index.js';
import type { MutationOperation } from '../../mutation-operations.js';
import { RetrievalMemoryError } from '../../errors.js';
import type { RetrievalMutationDefinition, RetrievalMutationOptions } from './types/workflow.js';

export function createRetrievalMutationDefinition<
  I,
  K extends MutationOperation = MutationOperation,
>(operation: K, options: RetrievalMutationOptions<I, K> = {}): RetrievalMutationDefinition<I, K> {
  return {
    ...options,
    name: `retrieval-memory:${operation}`,
    entryStep: 'runOperation',
    createState: ({ input }) => ({ input }),
    createSkippedResult: createSkippedRetrievalResult,
    createResult(state) {
      if (state.outcome === undefined)
        throw preserveRetrievalCommit(
          new RetrievalMemoryError(
            'REPRESENTATION_INVALID',
            'Retrieval mutation completed without a publication.'
          ),
          state
        );
      return state.outcome;
    },
    executeStep: retrievalExecutor(options.executeStep),
    lifecycle: retrievalLifecycle(options.lifecycle),
    stepDefinitions: createMutationStepDefinitions<I, K>(operation),
  };
}
