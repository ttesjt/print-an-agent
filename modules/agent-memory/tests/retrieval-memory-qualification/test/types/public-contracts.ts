import { Workflow, type RunnableWorkflow } from '@print-an-agent/workflow-core';
import {
  createRetrievalContentBundle,
  createRetrievalContentQueries,
  createRetrievalContext,
  createRetrievalGetDefinition,
  createRetrievalIngestDefinition,
  createRetrievalInspectDefinition,
  createRetrievalListDefinition,
  createRetrievalMemoryBundle,
  createRetrievalReceiptDefinition,
  createRetrievalRemoveDefinition,
  createRetrievalWorkflowResources,
  type IngestInput,
  type EntryMutationInput,
  type RetrievalMutationOutcome,
  type SpaceInput,
  type RetrievalSpace,
  type RetrievalReadOutcome,
  type RetrievalBackend,
  type RetrievalMutationDefinition,
  type RetrievalMutationOptions,
  type RetrievalMutationResources,
  type RetrievalQueryOperations,
  type RetrievalResources,
} from '@print-an-agent/retrieval-memory';

// Intentionally inferred exports also qualify declaration emission by an independent consumer.
export function contentBundle(backend: RetrievalBackend) {
  return createRetrievalContentBundle({ backend });
}
export function configureContentWorkflowOverrides(
  options: Parameters<typeof createRetrievalContentBundle>[0]
): void {
  if (options.workflows) {
    options.workflows.inspect = createRetrievalInspectDefinition();
    options.workflows.get = createRetrievalGetDefinition();
    options.workflows.getReceipt = createRetrievalReceiptDefinition();
    options.workflows.list = createRetrievalListDefinition();
    options.workflows.remove = createRetrievalRemoveDefinition();
    delete options.workflows.inspect;
  }
  // @ts-expect-error The options slot stays readonly; individual overrides remain writable.
  options.workflows = {};
}
export function fullBundle(raw: RetrievalResources) {
  return createRetrievalMemoryBundle({ resources: createRetrievalWorkflowResources(raw) });
}
export function standaloneRemove(
  resources: RetrievalMutationResources<'remove'>
): RunnableWorkflow<EntryMutationInput, RetrievalMutationOutcome> {
  return new Workflow({ ...createRetrievalRemoveDefinition(), resources });
}
export function standaloneInspect(
  backend: RetrievalBackend
): RunnableWorkflow<SpaceInput, RetrievalReadOutcome<RetrievalSpace>> {
  return new Workflow({
    ...createRetrievalInspectDefinition(),
    resources: { queries: createRetrievalContentQueries({ backend }) },
  });
}
export function inputOverride(): RetrievalMutationDefinition<IngestInput> {
  return createRetrievalIngestDefinition({
    stepOverrides: {
      prepareInput({ state }) {
        state.input = { ...state.input, content: state.input.content.toUpperCase() };
        return Promise.resolve();
      },
    },
  });
}
export function contextFromSearch(queries: Pick<RetrievalQueryOperations, 'search'>) {
  return createRetrievalContext(queries);
}

export const customInput: RetrievalMutationOptions<{ readonly command: string }, 'remove'> = {
  stepOverrides: {
    async prepareCandidate({ state, resources, signal }) {
      state.input.command.toUpperCase();
      await resources.mutations.prepare('remove', state.input, signal);
      // @ts-expect-error A remove-only Workflow does not acquire representation mutations.
      await resources.mutations.prepare('ingest', state.input, signal);
    },
  },
};
export function requiredCapabilities(backend: RetrievalBackend): void {
  // @ts-expect-error Full assembly requires explicit embedding and chunker resolvers.
  createRetrievalWorkflowResources({ backend });
  // @ts-expect-error A Content Bundle still requires an explicit backend.
  createRetrievalContentBundle({});
}
