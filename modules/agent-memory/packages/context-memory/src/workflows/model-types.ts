import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-bundle';
import { composeExecutionSignal, type WorkflowContext } from '@print-an-agent/workflow-core';
import type { ModelEditOperation } from '../contracts/document.js';
import type { ModelMemoryInput } from '../contracts/model.js';
import type { MutationResult } from '../contracts/receipt.js';
import type { MemoryUpdate } from '../domain/update.js';
import type { MemoryCandidateAssessment } from '../planning/assessment.js';
import type { ModelMemoryResources } from './model-resources.js';
import type { ModelMemoryWorkflowInput } from './input-preparation.js';

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
export interface ModelMemoryState<
  I extends ModelMemoryInput = ModelMemoryInput,
> extends ModelMemoryWorkflowInput<I> {
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
  I,
  ModelMemoryState<I>,
  ModelMemoryResources,
  MutationResult
>;
export type ModelMemoryWorkflowOptions<I extends ModelMemoryInput> = Pick<
  ModelMemoryDefinition<I>,
  'condition' | 'lifecycle' | 'stepOverrides' | 'executeStep' | 'createRunId'
>;
const signals = new WeakMap<ModelMemoryState, AbortSignal>();
export function bindModelMemorySignal(context: ModelMemoryContext, signal: AbortSignal): void {
  signals.set(context.state, signal);
}
/** Also preserves a child Core scope's cancellation; custom Steps use this for borrowed calls. */
export function modelMemorySignal(context: ModelMemoryContext): AbortSignal {
  const signal = signals.get(context.state);
  return signal === undefined ? context.signal : composeExecutionSignal([context.signal, signal]);
}
