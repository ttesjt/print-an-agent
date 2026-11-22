import { ContextMemoryError } from '../../errors.js';
import { createMemoryInputPreparation, requirePreparedMemoryInput } from './input-preparation.js';
import { memoryLifecycle } from './lifecycle.js';
import { memoryExecutor, requireMemoryOperationOutput } from './output.js';
import type { MemoryOperationDefinition, MemoryOperationOptions } from './types/workflow.js';

/** Core definition only: no second runner, implicit I/O, or global operation state. */
export function memoryDefinition<I, O, K extends keyof Operations, Operations extends object>(
  name: string,
  createSkippedResult: () => O,
  execute: (
    resources: { readonly memory: Pick<Operations, K> },
    input: I,
    signal: AbortSignal
  ) => Promise<O>,
  options: MemoryOperationOptions<I, O, K, Operations>,
  mutation = false
): MemoryOperationDefinition<I, O, K, Operations> {
  return {
    ...options,
    name,
    entryStep: 'runMemoryOperation',
    createState: ({ input }) => createMemoryInputPreparation(input),
    createSkippedResult,
    createResult: requireMemoryOperationOutput,
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
          const value = await execute(
            context.resources,
            requirePreparedMemoryInput(context.state),
            context.signal
          );
          context.state.operationOutput = { value };
        },
      },
    },
    lifecycle: memoryLifecycle(options.lifecycle),
  };
}
