import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';
import type {
  ContextCandidate,
  ReadContextInput,
  ReadContextResult,
  RetrievalContextOperations,
} from '../../context/index.js';
import type { RetrievalHit } from '../../types/search.js';
import type { RetrievalExecutionPolicy, RetrievalReadOutcome } from '../shared/index.js';

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
  RetrievalContextResources,
  RetrievalReadOutcome<ReadContextResult>
>;

export type RetrievalContextWorkflowOptions = Pick<
  RetrievalContextDefinition,
  'stepOverrides' | 'executeStep' | 'condition' | 'lifecycle' | 'createRunId'
>;

export interface RetrievalContextResources {
  readonly context: RetrievalContextOperations;
  readonly execution?: RetrievalExecutionPolicy;
}
