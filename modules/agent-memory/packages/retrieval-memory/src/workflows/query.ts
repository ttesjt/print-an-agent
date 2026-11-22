import { effectiveRetrievalSignal } from './shared/index.js';
import type { RetrievalQueryResources } from './query/types/resources.js';
import type { RetrievalQueryOperations } from '../queries/index.js';
import { jsonSnapshot } from '../values/index.js';
import { runRetrievalExecution } from './execution.js';
import {
  createSkippedRetrievalResult,
  preserveRetrievalCommit,
  retrievalExecutor,
  retrievalLifecycle,
} from './outcomes.js';
import type { RetrievalReceipt } from '../types/publication.js';
import { RetrievalMemoryError } from '../errors.js';
import type { RetrievalQueryDefinition, RetrievalQueryOptions } from './query/types/workflow.js';

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
    stepDefinitions: {
      runOperation: {
        skippable: false,
        cardinality: 'at-most-once',
        step: (context) =>
          runRetrievalExecution(context.signal, context.resources.execution, async (signal) => {
            context.state.signal = signal;
            await context.runStep('prepareInput');
            await context.runStep('executeQuery');
          }),
      },
      prepareInput: {
        skippable: false,
        cardinality: 'at-most-once',
        step: (context) => {
          jsonSnapshot(context.state.input);
          context.state.input = structuredClone(context.state.input);
          return Promise.resolve();
        },
      },
      executeQuery: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          const value = await execute(
            context.resources,
            context.state.input,
            effectiveRetrievalSignal(context)
          );
          const known = receipt?.(value);
          if (known !== undefined) context.state.receipt = structuredClone(known);
          context.state.outcome = { status: 'completed', value };
        },
      },
    },
  };
}
