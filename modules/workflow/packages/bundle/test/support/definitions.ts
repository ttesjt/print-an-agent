import type { Step, WorkflowContext } from '@print-an-agent/workflow-core';
import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-bundle';

export interface ReadPorts {
  read(id: string, signal: AbortSignal): Promise<string>;
}
export interface WritePorts extends ReadPorts {
  write(id: string, value: string, signal: AbortSignal): Promise<void>;
}
export type ReadContext = WorkflowContext<
  'read' | 'validate',
  { id: string },
  void,
  ReadPorts,
  string
>;
export type WriteContext = WorkflowContext<
  'write' | 'validate',
  { id: string; value: string },
  void,
  WritePorts,
  number
>;
export type ReadDefinition = BundleWorkflowDefinition<
  'read' | 'validate',
  ReadContext['input'],
  void,
  ReadPorts,
  string
>;
export type WriteDefinition = BundleWorkflowDefinition<
  'write' | 'validate',
  WriteContext['input'],
  void,
  WritePorts,
  number
>;

export const validateId: Step<{ readonly input: { readonly id: string } }> = (context) => {
  if (context.input.id.trim() === '') throw new Error('Record ID is required.');
  return Promise.resolve();
};

export function readDefinition(step?: Step<ReadContext>): ReadDefinition {
  return {
    name: 'records.inspect',
    entryStep: 'read',
    createState: () => undefined,
    createResult: () => '',
    stepDefinitions: {
      read: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          await context.runStep('validate');
          if (step !== undefined) await step(context);
          else context.result = await context.resources.read(context.input.id, context.signal);
        },
      },
      validate: { step: validateId, skippable: false, cardinality: 'at-most-once' },
    },
  };
}

export function writeDefinition(step?: Step<WriteContext>): WriteDefinition {
  return {
    name: 'records.update',
    entryStep: 'write',
    createState: () => undefined,
    createResult: () => 0,
    stepDefinitions: {
      write: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          await context.runStep('validate');
          if (step !== undefined) await step(context);
          else {
            await context.resources.write(context.input.id, context.input.value, context.signal);
            context.result = context.input.value.length;
          }
        },
      },
      validate: { step: validateId, skippable: false, cardinality: 'at-most-once' },
    },
  };
}
