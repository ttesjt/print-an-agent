import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-bundle';
import type {
  ContextCandidate,
  ReadContextInput,
  ReadContextResult,
} from '../contracts/context.js';
import type { RetrievalHit } from '../contracts/data.js';
import type { RetrievalWorkflowResources } from './resources.js';
import type { RetrievalReadOutcome } from './query.js';
import { runRetrievalExecution } from './execution.js';
import { fail } from '../errors.js';
import { jsonSnapshot } from '../validation/json.js';
import { createSkippedRetrievalResult } from './outcomes.js';
export type ContextStepName = 'runOperation' | 'prepareInput' | 'search' | 'select' | 'finalize';
export interface ContextRunState {
  input: ReadContextInput;
  candidate?: ContextCandidate;
  selected: readonly RetrievalHit[];
  signal?: AbortSignal;
  outcome?: RetrievalReadOutcome<ReadContextResult>;
}
export type RetrievalContextDefinition = BundleWorkflowDefinition<
  ContextStepName,
  ReadContextInput,
  ContextRunState,
  Pick<RetrievalWorkflowResources, 'context' | 'execution'>,
  RetrievalReadOutcome<ReadContextResult>
>;
export type RetrievalContextWorkflowOptions = Pick<
  RetrievalContextDefinition,
  'stepOverrides' | 'executeStep' | 'condition' | 'lifecycle' | 'createRunId'
>;
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
    stepDefinitions: {
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
          jsonSnapshot(context.state.input);
          context.state.input = structuredClone(context.state.input);
          return Promise.resolve();
        },
      },
      search: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          context.state.candidate = await context.resources.context.search(
            context.state.input,
            context.state.signal ?? context.signal
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
            context.state.signal ?? context.signal
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
            context.state.signal ?? context.signal
          );
          context.state.outcome = { status: 'completed', value };
        },
      },
    },
  };
}
