import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';
import type { RetrievalQueryResources } from './resources.js';
import type { RetrievalQueryOperations } from '../domain/queries.js';
import type { SkippedRetrieval } from './mutation.js';
import { jsonSnapshot } from '../validation/json.js';
import { runRetrievalExecution } from './execution.js';
import {
  createSkippedRetrievalResult,
  preserveRetrievalCommit,
  retrievalExecutor,
  retrievalLifecycle,
  type CommittedRunState,
} from './outcomes.js';
import type { RetrievalReceipt } from '../contracts/publication.js';
import { RetrievalMemoryError } from '../errors.js';
export type RetrievalReadOutcome<O> =
  | { readonly status: 'completed'; readonly value: O }
  | SkippedRetrieval;
export type QueryStepName = 'runOperation' | 'prepareInput' | 'executeQuery';
export interface QueryState<I, O> extends CommittedRunState {
  signal?: AbortSignal;
  input: I;
  outcome?: RetrievalReadOutcome<O>;
}
export type RetrievalQueryDefinition<
  I,
  O,
  K extends keyof RetrievalQueryOperations = keyof RetrievalQueryOperations,
> = BundleWorkflowDefinition<
  QueryStepName,
  I,
  QueryState<I, O>,
  RetrievalQueryResources<K>,
  RetrievalReadOutcome<O>
>;
export type RetrievalQueryOptions<
  I,
  O,
  K extends keyof RetrievalQueryOperations = keyof RetrievalQueryOperations,
> = Pick<
  RetrievalQueryDefinition<I, O, K>,
  'stepOverrides' | 'executeStep' | 'condition' | 'lifecycle' | 'createRunId'
>;
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
            context.state.signal ?? context.signal
          );
          const known = receipt?.(value);
          if (known !== undefined) context.state.receipt = structuredClone(known);
          context.state.outcome = { status: 'completed', value };
        },
      },
    },
  };
}
