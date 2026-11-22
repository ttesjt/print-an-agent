import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';
import type { ContextCandidate, ReadContextInput, ReadContextResult } from '../../context/index.js';
import type { RetrievalHit } from '../../types/search.js';
import type { RetrievalWorkflowResources } from '../types/resources.js';
import type { RetrievalReadOutcome } from '../shared/types/outcome.js';

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
