import type { BundleWorkflowDefinition } from '@ta-agent/workflow-bundle';
import type { RetrievalWorkflowResources } from './resources.js';
import type { SkippedRetrieval } from './mutation.js';
import { jsonSnapshot } from '../validation/json.js';
import { runRetrievalExecution } from './execution.js';
export type RetrievalReadOutcome<O> =
  | { readonly status: 'completed'; readonly value: O }
  | SkippedRetrieval;
export type QueryStepName = 'runOperation' | 'prepareInput' | 'executeQuery';
export interface QueryState<I> {
  signal?: AbortSignal;
  input?: I;
}
export type RetrievalQueryDefinition<I, O> = BundleWorkflowDefinition<
  QueryStepName,
  I,
  QueryState<I>,
  RetrievalWorkflowResources,
  RetrievalReadOutcome<O>
>;
export type RetrievalQueryOptions<I, O> = Pick<
  RetrievalQueryDefinition<I, O>,
  'stepOverrides' | 'executeStep' | 'condition' | 'lifecycle' | 'createRunId'
>;
export function createRetrievalQueryDefinition<I, O>(
  name: string,
  execute: (resources: RetrievalWorkflowResources, input: I, signal: AbortSignal) => Promise<O>,
  options: RetrievalQueryOptions<I, O> = {}
): RetrievalQueryDefinition<I, O> {
  return {
    ...options,
    name: `retrieval-memory:${name}`,
    entryStep: 'runOperation',
    createState: () => ({}),
    createResult: () => ({ status: 'skipped', reason: 'Workflow condition skipped execution.' }),
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
          jsonSnapshot(context.input);
          context.state.input = structuredClone(context.input);
          return Promise.resolve();
        },
      },
      executeQuery: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          context.result = {
            status: 'completed',
            value: await execute(
              context.resources,
              context.state.input as I,
              context.state.signal ?? context.signal
            ),
          };
        },
      },
    },
  };
}
