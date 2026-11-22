import { createContextStepDefinitions } from './step-definitions.js';
import { createSkippedRetrievalResult } from '../shared/index.js';
import { fail } from '../../errors.js';
import type { RetrievalContextDefinition, RetrievalContextWorkflowOptions } from './types.js';

export function createRetrievalReadContextDefinition(
  options: RetrievalContextWorkflowOptions = {}
): RetrievalContextDefinition {
  return {
    ...options,
    name: 'retrieval-memory:readContext',
    entryStep: 'runOperation',
    createState: ({ input }) => ({ input, selected: [] }),
    createSkippedResult: createSkippedRetrievalResult,
    createResult(state) {
      if (state.outcome === undefined)
        fail('SEARCH_FAILED', 'Retrieval context completed without an output.');
      return state.outcome;
    },
    stepDefinitions: createContextStepDefinitions(),
  };
}
