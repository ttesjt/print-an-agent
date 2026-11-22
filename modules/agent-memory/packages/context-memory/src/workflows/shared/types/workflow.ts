import type { DeterministicMemoryWorkflowInput } from './input.js';
import type { MemoryOperationOutput } from './output.js';
import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';

export type MemoryStepName = 'runMemoryOperation' | 'prepareInput' | 'executeOperation';

export type MemoryWorkflowState<I, O> = DeterministicMemoryWorkflowInput<I> &
  MemoryOperationOutput<O>;

export type MemoryOperationDefinition<
  I,
  O,
  K extends keyof Operations,
  Operations extends object,
> = BundleWorkflowDefinition<
  MemoryStepName,
  I,
  MemoryWorkflowState<I, O>,
  { readonly memory: Pick<Operations, K> },
  O
>;

export type MemoryOperationOptions<
  I,
  O,
  K extends keyof Operations,
  Operations extends object,
> = Pick<
  MemoryOperationDefinition<I, O, K, Operations>,
  'stepOverrides' | 'condition' | 'executeStep' | 'lifecycle' | 'createRunId'
>;
