import {
  WorkflowBundle,
  type BundleWorkflowDefinition,
} from '@print-an-agent/workflow-core/bundle';

export interface DocumentReader {
  read(documentId: string, signal: AbortSignal): Promise<string>;
}
export interface DocumentReadResult {
  readonly text: string;
  readonly runId: string;
  readonly reads: number;
}
export interface DocumentWorkflowResources {
  readonly documents: DocumentReader;
}

/** Neutral implementation: explicit resources, no Service, Profile or Registry dependency. */
export function createDocumentBundle(resources: DocumentWorkflowResources) {
  const read: BundleWorkflowDefinition<
    'read',
    { readonly documentId: string },
    { readonly documentId: string; reads: number; text: string; runId: string },
    DocumentWorkflowResources,
    DocumentReadResult
  > = {
    name: 'documents.read',
    entryStep: 'read',
    createState: ({ input }) => ({ documentId: input.documentId, reads: 0, text: '', runId: '' }),
    createResult: ({ text, runId, reads }) => ({ text, runId, reads }),
    stepDefinitions: {
      read: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          context.state.text = await context.resources.documents.read(
            context.state.documentId,
            context.signal
          );
          context.state.reads += 1;
          context.state.runId = context.workflowRunId;
        },
      },
    },
  };
  return new WorkflowBundle({ resources, workflows: { read } });
}
export type DocumentBundle = ReturnType<typeof createDocumentBundle>;
