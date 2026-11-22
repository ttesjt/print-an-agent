import {
  detachRetrievalInput,
  effectiveRetrievalSignal,
  runRetrievalExecution,
} from '../shared/index.js';
import { fail } from '../../errors.js';
import type { RetrievalContextDefinition } from './types.js';

export function createContextStepDefinitions(): RetrievalContextDefinition['stepDefinitions'] {
  return {
    runOperation: {
      skippable: false,
      cardinality: 'at-most-once',
      step: (context) =>
        runRetrievalExecution(context.signal, context.resources.execution, async (signal) => {
          context.state.signal = signal;
          await context.runStep('prepareInput');
          await context.runStep('search');
          await context.runStep('select');
          await context.runStep('finalize');
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
    search: {
      skippable: false,
      cardinality: 'at-most-once',
      step: async (context) => {
        context.state.candidate = await context.resources.context.search(
          context.state.input,
          effectiveRetrievalSignal(context)
        );
      },
    },
    select: {
      skippable: true,
      cardinality: 'at-most-once',
      step: async (context) => {
        if (context.state.candidate === undefined)
          fail('SEARCH_FAILED', 'Context candidate is missing.');
        context.state.selected = await context.resources.context.select(
          context.state.candidate,
          effectiveRetrievalSignal(context)
        );
      },
    },
    finalize: {
      skippable: false,
      cardinality: 'at-most-once',
      step: async (context) => {
        if (context.state.candidate === undefined)
          fail('SEARCH_FAILED', 'Context candidate is missing.');
        const value = await context.resources.context.finalize(
          context.state.candidate,
          context.state.selected,
          effectiveRetrievalSignal(context)
        );
        context.state.outcome = { status: 'completed', value };
      },
    },
  };
}
