import {
  Workflow,
  skipWorkflow,
  RUN_WORKFLOW,
  type WorkflowContext,
} from '@ta-agent/workflow-core';

export interface CatalogRecord {
  readonly revision: number;
  readonly title: string;
}
export interface RecordStore {
  read(id: string, signal: AbortSignal): Promise<CatalogRecord>;
  compareAndSwap(
    id: string,
    revision: number,
    title: string,
    signal: AbortSignal
  ): Promise<CatalogRecord>;
}
export interface UpdatePorts {
  readonly records: RecordStore;
  readonly titleLimit: (signal: AbortSignal) => Promise<number>;
}
interface Input {
  readonly enabled: boolean;
  readonly id: string;
  readonly title: string;
}
interface State {
  record: CatalogRecord | undefined;
  limit: number | undefined;
}
export type UpdateResult =
  | { readonly status: 'not-updated' }
  | { readonly status: 'updated'; readonly record: CatalogRecord };
export type UpdateName = 'update' | 'load' | 'record' | 'rules' | 'validate' | 'commit';
export type UpdateContext = WorkflowContext<UpdateName, Input, State, UpdatePorts, UpdateResult>;

export function recordUpdate() {
  return new Workflow<UpdateName, Input, State, UpdatePorts, UpdateResult>({
    name: 'record-update',
    entryStep: 'update',
    createResult: () => ({ status: 'not-updated' }),
    createState: () => ({ record: undefined, limit: undefined }),
    condition: ({ input }) => (input.enabled ? RUN_WORKFLOW : skipWorkflow('updates disabled')),
    stepDefinitions: {
      update: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (c) => {
          await c.runStep('load');
          await c.runStep('validate');
          await c.runStep('commit');
        },
      },
      load: {
        skippable: false,
        cardinality: 'at-most-once',
        step: (c) => c.parallel(['record', 'rules']),
      },
      record: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (c) => {
          c.state.record = await c.resources.records.read(c.input.id, c.signal);
        },
      },
      rules: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (c) => {
          c.state.limit = await c.resources.titleLimit(c.signal);
        },
      },
      validate: {
        skippable: false,
        cardinality: 'at-most-once',
        step: (c) => {
          if (c.state.limit === undefined || c.input.title.length > c.state.limit)
            throw new Error('Title rejected.');
          return Promise.resolve();
        },
      },
      commit: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (c) => {
          if (c.state.record === undefined) throw new Error('Record was not loaded.');
          const record = await c.resources.records.compareAndSwap(
            c.input.id,
            c.state.record.revision,
            c.input.title,
            c.signal
          );
          c.result = { status: 'updated', record };
        },
      },
    },
  });
}
