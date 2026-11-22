import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';
import type { MutationOperation } from '../../../mutation-operations.js';
import type { MutationResult } from '../../../types/publication.js';
import type { PreparedMutation } from '../../../persistence/index.js';
import type { RetrievalMutationResources } from './resources.js';
import type { CommittedRunState, SkippedRetrieval } from '../../shared/index.js';

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
