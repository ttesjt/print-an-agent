import {
  detachRetrievalInput,
  effectiveRetrievalSignal,
  runRetrievalExecution,
} from '../shared/index.js';
import type { RetrievalQueryResources } from './types/resources.js';
import type { RetrievalQueryOperations } from '../../queries/index.js';
import type { RetrievalReceipt } from '../../types/publication.js';
import type { RetrievalQueryDefinition } from './types/workflow.js';

export function createQueryStepDefinitions<
  I,
  O,
  K extends keyof RetrievalQueryOperations = keyof RetrievalQueryOperations,
>(
  execute: (resources: RetrievalQueryResources<K>, input: I, signal: AbortSignal) => Promise<O>,
  receipt?: (value: O) => RetrievalReceipt | undefined
): RetrievalQueryDefinition<I, O, K>['stepDefinitions'] {
  return {
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
        context.state.input = detachRetrievalInput(context.state.input);
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
  };
}
