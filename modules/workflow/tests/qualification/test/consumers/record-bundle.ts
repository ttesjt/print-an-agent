import { WorkflowBundle, type BundleWorkflowDefinition } from '@ta-agent/workflow-bundle';
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
  void,
  { records: Pick<RecordStore, 'read'> },
  CatalogRecord | undefined
> {
  return {
    name: 'record-inspection',
    entryStep: 'inspect',
    createResult: () => undefined,
    createState: () => undefined,
    stepDefinitions: {
      inspect: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          context.result = await context.resources.records.read(context.input.id, context.signal);
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
