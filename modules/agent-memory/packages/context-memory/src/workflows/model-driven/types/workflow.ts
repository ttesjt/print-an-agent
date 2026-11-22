import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';
import type { WorkflowContext } from '@print-an-agent/workflow-core';
import type {
  ModelEditOperation,
  ModelMemoryInput,
  MemoryUpdate,
} from '../../../model-update/index.js';
import type { MutationResult } from '../../../types/receipt.js';
import type { MemoryCandidateAssessment } from '../../../budget/index.js';
import type { ModelMemoryResources } from './resources.js';
import type { ModelMemoryWorkflowInput } from '../../shared/types/input.js';
import type { MemoryOperationOutput } from '../../shared/types/output.js';

export type ModelMemoryStepName =
  | 'runModelOperation'
  | 'prepareInput'
  | 'beginUpdate'
  | 'checkInputBudget'
  | 'planUpdate'
  | 'applyUpdate'
  | 'measureCandidate'
  | 'assessCandidate'
  | 'planCompaction'
  | 'applyCompaction'
  | 'refineCompactionPlan'
  | 'commitCandidate';

export interface ModelMemoryState<I extends ModelMemoryInput = ModelMemoryInput>
  extends ModelMemoryWorkflowInput<I>, MemoryOperationOutput<MutationResult> {
  update?: MemoryUpdate;
  operations?: readonly ModelEditOperation[];
  measured?: MemoryCandidateAssessment;
  assessment?: MemoryCandidateAssessment;
  plannerTargetTokens?: number;
  compactionPasses: number;
  conflictRetries: number;
}

export type ModelMemoryDefinition<I extends ModelMemoryInput = ModelMemoryInput> =
  BundleWorkflowDefinition<
    ModelMemoryStepName,
    I,
    ModelMemoryState<I>,
    ModelMemoryResources,
    MutationResult
  >;

export type ModelMemoryContext<I extends ModelMemoryInput = ModelMemoryInput> = WorkflowContext<
  ModelMemoryStepName,
  ModelMemoryState<I>,
  ModelMemoryResources
>;

export type ModelMemoryWorkflowOptions<I extends ModelMemoryInput> = Pick<
  ModelMemoryDefinition<I>,
  'condition' | 'lifecycle' | 'stepOverrides' | 'executeStep' | 'createRunId'
>;
