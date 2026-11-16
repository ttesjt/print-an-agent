import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-bundle';
import type { MemoryOperations } from './resources.js';
import { ContextMemoryError } from '../errors.js';
import {
  createMemoryInputPreparation,
  requirePreparedMemoryInput,
  type DeterministicMemoryWorkflowInput,
} from './input-preparation.js';
import { memoryLifecycle } from './lifecycle.js';
import { memoryExecutor } from './outcome.js';

export type MemoryStepName = 'runMemoryOperation' | 'prepareInput' | 'executeOperation';
export type MemoryWorkflowState<I> = DeterministicMemoryWorkflowInput<I>;
export type MemoryDefinition<
  I,
  O,
  K extends keyof Operations,
  Operations extends object = MemoryOperations,
> = BundleWorkflowDefinition<
  MemoryStepName,
  I,
  MemoryWorkflowState<I>,
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

/** Core definition only: no second runner, implicit I/O, or global operation state. */
export function memoryDefinition<
  I,
  O,
  K extends keyof Operations,
  Operations extends object = MemoryOperations,
>(
  name: string,
  initial: () => O,
  execute: (
    resources: { readonly memory: Pick<Operations, K> },
    input: I,
    signal: AbortSignal
  ) => Promise<O>,
  options: MemoryWorkflowOptions<I, O, K, Operations>,
  mutation = false
): MemoryDefinition<I, O, K, Operations> {
  return {
    ...options,
    name,
    entryStep: 'runMemoryOperation',
    createState: ({ input }) => createMemoryInputPreparation(input),
    createResult: initial,
    ...(mutation ? { executeStep: memoryExecutor(options.executeStep) } : {}),
    stepDefinitions: {
      runMemoryOperation: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          await context.runStep('prepareInput');
          await context.runStep('executeOperation');
        },
      },
      prepareInput: {
        skippable: false,
        cardinality: 'at-most-once',
        step: (context) => {
          try {
            context.state.prepareInput();
          } catch (cause) {
            throw new ContextMemoryError('INPUT_INVALID', 'Workflow input must be JSON data.', {
              cause,
              ...(mutation ? { commit: { status: 'not-committed' as const } } : {}),
            });
          }
          return Promise.resolve();
        },
      },
      executeOperation: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          context.result = await execute(
            context.resources,
            requirePreparedMemoryInput(context.state),
            context.signal
          );
        },
      },
    },
    lifecycle: memoryLifecycle(options.lifecycle),
  };
}
