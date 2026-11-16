import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-bundle';
import type { MutationOperation } from '../contracts/inputs.js';
import type { MutationResult } from '../contracts/publication.js';
import type { PreparedMutation } from '../domain/mutations.js';
import type { RetrievalMutationResources } from './resources.js';
import { jsonSnapshot } from '../validation/json.js';
import { fail, RetrievalMemoryError } from '../errors.js';
import { runRetrievalExecution } from './execution.js';
import {
  createSkippedRetrievalResult,
  preserveRetrievalCommit,
  retrievalExecutor,
  retrievalLifecycle,
  type CommittedRunState,
} from './outcomes.js';
export interface SkippedRetrieval {
  readonly status: 'skipped';
  readonly reason: string;
}
export type RetrievalMutationOutcome = MutationResult | SkippedRetrieval;
export type MutationStepName = 'runOperation' | 'prepareInput' | 'prepareCandidate' | 'publish';
export interface MutationState<I> extends CommittedRunState {
  signal?: AbortSignal;
  input: I;
  candidate?: PreparedMutation;
  outcome?: RetrievalMutationOutcome;
}
export type RetrievalMutationDefinition<
  I,
  K extends MutationOperation = MutationOperation,
> = BundleWorkflowDefinition<
  MutationStepName,
  I,
  MutationState<I>,
  RetrievalMutationResources<K>,
  RetrievalMutationOutcome
>;
export type RetrievalMutationOptions<I, K extends MutationOperation = MutationOperation> = Pick<
  RetrievalMutationDefinition<I, K>,
  'stepOverrides' | 'executeStep' | 'condition' | 'lifecycle' | 'createRunId'
>;
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
            context.state.signal ?? context.signal
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
            context.state.signal ?? context.signal
          );
          context.state.receipt = structuredClone(result.receipt);
          context.state.outcome = result;
        },
      },
    },
  };
}
