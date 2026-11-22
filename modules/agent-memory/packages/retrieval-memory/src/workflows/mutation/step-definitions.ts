import {
  detachRetrievalInput,
  effectiveRetrievalSignal,
  runRetrievalExecution,
} from '../shared/index.js';
import type { MutationOperation } from '../../mutation-operations.js';
import { fail } from '../../errors.js';
import type { RetrievalMutationDefinition } from './types/workflow.js';

export function createMutationStepDefinitions<I, K extends MutationOperation = MutationOperation>(
  operation: K
): RetrievalMutationDefinition<I, K>['stepDefinitions'] {
  return {
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
        context.state.input = detachRetrievalInput(context.state.input);
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
  };
}
