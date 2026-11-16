import { WorkflowBundle, type BundleWorkflowDefinition } from '@print-an-agent/workflow-bundle';
import {
  recordUpdateDefinition,
  type CatalogRecord,
  type RecordStore,
  type UpdatePorts,
} from './record-update.js';

/** Inspection declares only its read capability; Bundle passes the complete, unchanged resources. */
export function recordInspectionDefinition(): BundleWorkflowDefinition<
  'inspect',
  { id: string },
  { readonly id: string; record?: CatalogRecord },
  { records: Pick<RecordStore, 'read'> },
  CatalogRecord | undefined
> {
  return {
    name: 'record-inspection',
    entryStep: 'inspect',
    createResult: ({ record }) => record,
    createState: ({ input }) => ({ id: input.id }),
    stepDefinitions: {
      inspect: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          context.state.record = await context.resources.records.read(
            context.state.id,
            context.signal
          );
        },
      },
    },
  };
}

export function recordBundle(resources: UpdatePorts) {
  return new WorkflowBundle({
    resources,
    workflows: { update: recordUpdateDefinition(), inspect: recordInspectionDefinition() },
  });
}
