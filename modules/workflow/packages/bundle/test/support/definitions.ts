import type { Step, WorkflowContext } from '@print-an-agent/workflow-core';
import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-bundle';

export interface ReadPorts {
  read(id: string, signal: AbortSignal): Promise<string>;
}
export interface WritePorts extends ReadPorts {
  write(id: string, value: string, signal: AbortSignal): Promise<void>;
}
export interface ReadInput {
  readonly id: string;
}
export interface WriteInput extends ReadInput {
  readonly value: string;
}
export type ReadContext = WorkflowContext<
  'read' | 'validate',
  { readonly input: ReadInput },
  ReadPorts,
  string
>;
export type WriteContext = WorkflowContext<
  'write' | 'validate',
  { readonly input: WriteInput },
  WritePorts,
  number
>;
export type ReadDefinition = BundleWorkflowDefinition<
  'read' | 'validate',
  ReadInput,
  ReadContext['state'],
  ReadPorts,
  string
>;
export type WriteDefinition = BundleWorkflowDefinition<
  'write' | 'validate',
  WriteInput,
  WriteContext['state'],
  WritePorts,
  number
>;

export const validateId: Step<{ readonly state: { readonly input: ReadInput } }> = (context) => {
  if (context.state.input.id.trim() === '') throw new Error('Record ID is required.');
  return Promise.resolve();
};

export function readDefinition(step?: Step<ReadContext>): ReadDefinition {
  return {
    name: 'records.inspect',
    entryStep: 'read',
    createState: ({ input }) => ({ input }),
    createResult: () => '',
    stepDefinitions: {
      read: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          await context.runStep('validate');
          if (step !== undefined) await step(context);
          else
            context.result = await context.resources.read(context.state.input.id, context.signal);
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
    createState: ({ input }) => ({ input }),
    createResult: () => 0,
    stepDefinitions: {
      write: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          await context.runStep('validate');
          if (step !== undefined) await step(context);
          else {
            await context.resources.write(
              context.state.input.id,
              context.state.input.value,
              context.signal
            );
            context.result = context.state.input.value.length;
          }
        },
      },
      validate: { step: validateId, skippable: false, cardinality: 'at-most-once' },
    },
  };
}
