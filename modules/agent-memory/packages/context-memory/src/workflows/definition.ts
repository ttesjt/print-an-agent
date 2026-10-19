import type { BundleWorkflowDefinition } from '@ta-agent/workflow-bundle';
import type { MemoryOperations, MemoryWorkflowResources } from './resources.js';
import { ContextMemoryError } from '../errors.js';
import { jsonValue } from '../validation/value.js';
import { memoryLifecycle } from './lifecycle.js';
import { memoryExecutor } from './outcome.js';

export type MemoryStepName = 'runMemoryOperation' | 'prepareInput' | 'executeOperation';
export interface MemoryWorkflowState<I> {
  input?: I;
}
export type MemoryDefinition<I, O, K extends keyof MemoryOperations> = BundleWorkflowDefinition<
  MemoryStepName,
  I,
  MemoryWorkflowState<I>,
  MemoryWorkflowResources<K>,
  O
>;
export type MemoryWorkflowOptions<I, O, K extends keyof MemoryOperations> = Pick<
  MemoryDefinition<I, O, K>,
  'stepOverrides' | 'condition' | 'executeStep' | 'lifecycle' | 'createRunId'
>;

/** Core definition only: no second runner, implicit I/O, or global operation state. */
export function memoryDefinition<I, O, K extends keyof MemoryOperations>(
  name: string,
  initial: () => O,
  execute: (resources: MemoryWorkflowResources<K>, input: I, signal: AbortSignal) => Promise<O>,
  options: MemoryWorkflowOptions<I, O, K>,
  mutation = false
): MemoryDefinition<I, O, K> {
  return {
    ...options,
    name,
    entryStep: 'runMemoryOperation',
    createState: () => ({}),
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
            jsonValue(context.input);
            context.state.input = structuredClone(context.input);
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
          if (context.state.input === undefined)
            throw new ContextMemoryError('INPUT_INVALID', 'Prepared input is missing.');
          context.result = await execute(context.resources, context.state.input, context.signal);
        },
      },
    },
    lifecycle: memoryLifecycle(options.lifecycle),
  };
}
