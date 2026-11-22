import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';
import type { RetrievalQueryResources } from './resources.js';
import type { RetrievalQueryOperations } from '../../../queries/index.js';
import type { CommittedRunState, RetrievalReadOutcome } from '../../shared/index.js';

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
