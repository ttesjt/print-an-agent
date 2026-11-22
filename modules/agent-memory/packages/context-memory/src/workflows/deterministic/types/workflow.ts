import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';
import type { MemoryOperations } from './resources.js';
import type { DeterministicMemoryWorkflowInput } from '../../shared/types/input.js';
import type { MemoryOperationOutput } from '../../shared/types/output.js';

export type MemoryStepName = 'runMemoryOperation' | 'prepareInput' | 'executeOperation';

export type MemoryWorkflowState<I, O> = DeterministicMemoryWorkflowInput<I> &
  MemoryOperationOutput<O>;

export type MemoryDefinition<
  I,
  O,
  K extends keyof Operations,
  Operations extends object = MemoryOperations,
> = BundleWorkflowDefinition<
  MemoryStepName,
  I,
  MemoryWorkflowState<I, O>,
  { readonly memory: Pick<Operations, K> },
  O
>;

export type MemoryWorkflowOptions<
  I,
  O,
  K extends keyof Operations,
  Operations extends object = MemoryOperations,
> = Pick<
  MemoryDefinition<I, O, K, Operations>,
  'stepOverrides' | 'condition' | 'executeStep' | 'lifecycle' | 'createRunId'
>;
