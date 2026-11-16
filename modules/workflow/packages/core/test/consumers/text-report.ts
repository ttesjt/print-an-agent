import {
  createSequentialStep,
  Workflow,
  type StepOverrides,
  type WorkflowContext,
} from '@print-an-agent/workflow-core';

type Name = 'report' | 'read' | 'normalize' | 'write';
export interface ReportInput {
  readonly source: string;
  readonly destination: string;
}
export interface TextFiles {
  read(name: string, signal: AbortSignal): Promise<string>;
  write(name: string, content: string, signal: AbortSignal): Promise<void>;
}
export type ReportContext = WorkflowContext<
  Name,
  { source: string; destination: string; text: string; written: string[] },
  TextFiles
>;

/** Ordinary data processing, no identity, Agent Run, database, or Memory contract. */
export function textReport(resources: TextFiles, overrides?: StepOverrides<Name, ReportContext>) {
  return new Workflow<Name, ReportInput, ReportContext['state'], TextFiles, { written: string[] }>({
    name: 'text-report',
    resources,
    entryStep: 'report',
    createState: ({ input }) => ({
      source: input.source,
      destination: input.destination,
      text: '',
      written: [],
    }),
    createResult: ({ written }) => ({ written }),
    ...(overrides === undefined ? {} : { stepOverrides: overrides }),
    stepDefinitions: {
      report: {
        skippable: false,
        cardinality: 'at-most-once',
        step: createSequentialStep<Name, ReportContext>(['read', 'normalize', 'write']),
      },
      read: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (c) => {
          c.state.text = await c.resources.read(c.state.source, c.signal);
        },
      },
      normalize: {
        skippable: true,
        cardinality: 'at-most-once',
        step: (c) => {
          c.state.text = c.state.text.trim().toLowerCase();
          return Promise.resolve();
        },
      },
      write: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (c) => {
          await c.resources.write(c.state.destination, c.state.text, c.signal);
          c.state.written.push(c.state.destination);
        },
      },
    },
  });
}
