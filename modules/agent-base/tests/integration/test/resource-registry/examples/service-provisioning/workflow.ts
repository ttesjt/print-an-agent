import { WorkflowBundle, type BundleWorkflowDefinition } from '@ta-agent/workflow-bundle';

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
    { reads: number },
    DocumentWorkflowResources,
    DocumentReadResult
  > = {
    name: 'documents.read',
    entryStep: 'read',
    createState: () => ({ reads: 0 }),
    createResult: () => ({ text: '', runId: '', reads: 0 }),
    stepDefinitions: {
      read: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          const text = await context.resources.documents.read(
            context.input.documentId,
            context.signal
          );
          context.state.reads += 1;
          context.result = { text, runId: context.workflowRunId, reads: context.state.reads };
        },
      },
    },
  };
  return new WorkflowBundle({ resources, workflows: { read } });
}
export type DocumentBundle = ReturnType<typeof createDocumentBundle>;
