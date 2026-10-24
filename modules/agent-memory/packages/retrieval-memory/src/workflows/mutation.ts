import type { BundleWorkflowDefinition } from '@ta-agent/workflow-bundle';
import type { MutationOperation } from '../contracts/inputs.js';
import type { MutationResult } from '../contracts/publication.js';
import type { PreparedMutation } from '../domain/mutations.js';
import type { RetrievalWorkflowResources } from './resources.js';
import { jsonSnapshot } from '../validation/json.js';
import { fail } from '../errors.js';
import { runRetrievalExecution } from './execution.js';
import { retrievalExecutor, retrievalLifecycle, type CommittedRunState } from './outcomes.js';
export interface SkippedRetrieval {
  readonly status: 'skipped';
  readonly reason: string;
}
export type RetrievalMutationOutcome = MutationResult | SkippedRetrieval;
export type MutationStepName = 'runOperation' | 'prepareInput' | 'prepareCandidate' | 'publish';
export interface MutationState<I> extends CommittedRunState {
  signal?: AbortSignal;
  input?: I;
  candidate?: PreparedMutation;
}
export type RetrievalMutationDefinition<I> = BundleWorkflowDefinition<
  MutationStepName,
  I,
  MutationState<I>,
  RetrievalWorkflowResources,
  RetrievalMutationOutcome
>;
export type RetrievalMutationOptions<I> = Pick<
  RetrievalMutationDefinition<I>,
  'stepOverrides' | 'executeStep' | 'condition' | 'lifecycle' | 'createRunId'
>;
export function createRetrievalMutationDefinition<I>(
  operation: MutationOperation,
  options: RetrievalMutationOptions<I> = {}
): RetrievalMutationDefinition<I> {
  return {
    ...options,
    name: `retrieval-memory:${operation}`,
    entryStep: 'runOperation',
    createState: () => ({}),
    createResult: () => ({ status: 'skipped', reason: 'Workflow condition skipped execution.' }),
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
          jsonSnapshot(context.input);
          context.state.input = structuredClone(context.input);
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
          context.result = result;
        },
      },
    },
  };
}
