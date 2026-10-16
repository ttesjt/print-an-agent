import {
  createSequentialStep,
  Workflow,
  type StepOverrides,
  type WorkflowContext,
} from '@ta-agent/workflow-core';

type Name = 'report' | 'read' | 'normalize' | 'write';
export interface TextFiles {
  read(name: string, signal: AbortSignal): Promise<string>;
  write(name: string, content: string, signal: AbortSignal): Promise<void>;
}
export type ReportContext = WorkflowContext<
  Name,
  { source: string; destination: string },
  { text: string },
  TextFiles,
  { written: string[] }
>;

/** Ordinary data processing, no identity, Agent Run, database, or Memory contract. */
export function textReport(resources: TextFiles, overrides?: StepOverrides<Name, ReportContext>) {
  return new Workflow<
    Name,
    ReportContext['input'],
    ReportContext['state'],
    TextFiles,
    ReportContext['result']
  >({
    name: 'text-report',
    resources,
    entryStep: 'report',
    createState: () => ({ text: '' }),
    createResult: () => ({ written: [] }),
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
          c.state.text = await c.resources.read(c.input.source, c.signal);
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
          await c.resources.write(c.input.destination, c.state.text, c.signal);
          c.result.written.push(c.input.destination);
        },
      },
    },
  });
}
