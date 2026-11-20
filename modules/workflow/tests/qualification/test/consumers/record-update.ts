import {
  Workflow,
  skipWorkflow,
  RUN_WORKFLOW,
  type WorkflowContext,
} from '@print-an-agent/workflow-core';
import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';

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
export interface UpdateInput {
  readonly enabled: boolean;
  readonly id: string;
  readonly title: string;
}
export interface UpdateState {
  readonly id: string;
  readonly title: string;
  record: CatalogRecord | undefined;
  limit: number | undefined;
  updatedRecord?: CatalogRecord;
}
export type UpdateResult =
  | { readonly status: 'not-updated' }
  | { readonly status: 'updated'; readonly record: CatalogRecord };
export type UpdateName = 'update' | 'load' | 'record' | 'rules' | 'validate' | 'commit';
export type UpdateContext = WorkflowContext<UpdateName, UpdateState, UpdatePorts>;

export function recordUpdate(resources: UpdatePorts) {
  return new Workflow({ ...recordUpdateDefinition(), resources });
}

/** The same unbound definition is reusable independently or inside a Bundle. */
export function recordUpdateDefinition(): BundleWorkflowDefinition<
  UpdateName,
  UpdateInput,
  UpdateState,
  UpdatePorts,
  UpdateResult
> {
  return {
    name: 'record-update',
    entryStep: 'update',
    createSkippedResult: () => ({ status: 'not-updated' }),
    createResult({ updatedRecord }) {
      if (updatedRecord === undefined) throw new Error('Record was not updated.');
      return { status: 'updated', record: updatedRecord };
    },
    createState: ({ input }) => ({
      id: input.id,
      title: input.title,
      record: undefined,
      limit: undefined,
    }),
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
          c.state.record = await c.resources.records.read(c.state.id, c.signal);
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
          if (c.state.limit === undefined || c.state.title.length > c.state.limit)
            throw new Error('Title rejected.');
          return Promise.resolve();
        },
      },
      commit: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (c) => {
          if (c.state.record === undefined) throw new Error('Record was not loaded.');
          c.state.updatedRecord = await c.resources.records.compareAndSwap(
            c.state.id,
            c.state.record.revision,
            c.state.title,
            c.signal
          );
        },
      },
    },
  };
}
