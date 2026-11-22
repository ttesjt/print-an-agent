import { effectiveRetrievalSignal } from './shared/index.js';
import type { MutationOperation } from '../mutation-operations.js';
import { jsonSnapshot } from '../values/index.js';
import { fail, RetrievalMemoryError } from '../errors.js';
import { runRetrievalExecution } from './execution.js';
import {
  createSkippedRetrievalResult,
  preserveRetrievalCommit,
  retrievalExecutor,
  retrievalLifecycle,
} from './outcomes.js';
import type {
  RetrievalMutationDefinition,
  RetrievalMutationOptions,
} from './mutation/types/workflow.js';

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
    stepDefinitions: {
      runOperation: {
        skippable: false,
        cardinality: 'at-most-once',
        step: (context) =>
          runRetrievalExecution(context.signal, context.resources.execution, async (signal) => {
            context.state.signal = signal;
            await context.runStep('prepareInput');
            await context.runStep('prepareCandidate');
            await context.runStep('publish');
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
      prepareCandidate: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          context.state.candidate = await context.resources.mutations.prepare(
            operation,
            context.state.input,
            effectiveRetrievalSignal(context)
          );
          // Replaying a matched durable receipt already establishes commit, before
          // the next Step's cancellation check or this Step's executor post-processing.
          if ('receipt' in context.state.candidate)
            context.state.receipt = structuredClone(context.state.candidate.receipt);
        },
      },
      publish: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          if (context.state.candidate === undefined)
            fail('REPRESENTATION_INVALID', 'Publication candidate is missing.');
          const result = await context.resources.mutations.publish(
            context.state.candidate,
            effectiveRetrievalSignal(context)
          );
          context.state.receipt = structuredClone(result.receipt);
          context.state.outcome = result;
        },
      },
    },
  };
}
