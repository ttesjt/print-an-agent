import { ResourceToken } from '@print-an-agent/base-composition/resource-registry';
import type {
  MemoryStore,
  ModelMemoryResources,
  ModelMemoryWorkflowDefinitions,
} from '@print-an-agent/context-memory';
import type {
  RetrievalBackend,
  RetrievalChunker,
  createRetrievalMemoryBundle,
} from '@print-an-agent/retrieval-memory';
import type {
  CompletionCapability,
  TextEmbeddingCapability,
  TextTokenInput,
  TokenCounter,
} from '@print-an-agent/model-invocation-core';
import { WorkflowBundle } from '@print-an-agent/workflow-bundle';

export type ContextBundle = WorkflowBundle<ModelMemoryResources, ModelMemoryWorkflowDefinitions>;
export type RetrievalBundle = ReturnType<typeof createRetrievalMemoryBundle>;
export type TextCounter = TokenCounter<TextTokenInput>;

function binding(input: unknown): string {
  if (typeof input !== 'string' || input.trim().length === 0)
    throw new Error('Expected an identity.');
  return input;
}
export const describeResource = (key: string) => ({ key, descriptor: key });
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
function bundleWith(value: unknown, names: readonly string[]): boolean {
  if (!(value instanceof WorkflowBundle)) return false;
  const workflows: unknown = value.workflows;
  return (
    record(workflows) &&
    names.every((name) => {
      const workflow = workflows[name];
      return (
        record(workflow) && typeof workflow.name === 'string' && typeof workflow.run === 'function'
      );
    })
  );
}

/** Profile-local token identities, not strings shared by unrelated applications. */
export function memoryTokens() {
  return Object.freeze({
    contextStore: new ResourceToken('example.context-store', {
      parseBinding: binding,
      isValue: (value): value is MemoryStore =>
        record(value) &&
        typeof value.read === 'function' &&
        typeof value.commit === 'function' &&
        typeof value.getReceipt === 'function',
    }),
    retrievalBackend: new ResourceToken('example.retrieval-backend', {
      parseBinding: binding,
      isValue: (value): value is RetrievalBackend =>
        record(value) &&
        ['inspect', 'get', 'getReceipt', 'publish', 'list', 'search'].every(
          (method) => typeof value[method] === 'function'
        ),
    }),
    counter: new ResourceToken('example.text-counter', {
      parseBinding: binding,
      isValue: (value): value is TextCounter =>
        record(value) &&
        typeof value.measure === 'function' &&
        record(value.descriptor) &&
        Array.isArray(value.descriptor.inputKinds) &&
        value.descriptor.inputKinds.some((kind: unknown) => kind === 'text'),
    }),
    completion: new ResourceToken('example.completion', {
      parseBinding: binding,
      isValue: (value): value is CompletionCapability =>
        record(value) && typeof value.complete === 'function',
    }),
    embedding: new ResourceToken('example.embedding', {
      parseBinding: binding,
      isValue: (value): value is TextEmbeddingCapability =>
        record(value) &&
        typeof value.embed === 'function' &&
        record(value.descriptor) &&
        value.descriptor.inputKind === 'text',
    }),
    chunker: new ResourceToken('example.chunker', {
      parseBinding: binding,
      isValue: (value): value is RetrievalChunker =>
        record(value) && typeof value.ref === 'string' && typeof value.chunk === 'function',
    }),
    context: new ResourceToken('example.context-bundle', {
      parseBinding: binding,
      isValue: (value): value is ContextBundle =>
        bundleWith(value, [
          'create',
          'apply',
          'configure',
          'readContext',
          'getReceipt',
          'observe',
          'edit',
          'compact',
        ]),
    }),
    retrieval: new ResourceToken('example.retrieval-bundle', {
      parseBinding: binding,
      isValue: (value): value is RetrievalBundle =>
        bundleWith(value, [
          'create',
          'ingest',
          'update',
          'remove',
          'reindex',
          'inspect',
          'get',
          'getReceipt',
          'list',
          'search',
          'readContext',
        ]),
    }),
  });
}
