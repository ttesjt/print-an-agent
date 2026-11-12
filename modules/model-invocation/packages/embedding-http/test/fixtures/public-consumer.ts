import {
  createTextEmbedder,
  EMBEDDING_TASK,
  type TextEmbeddingCapability,
  type TextEmbedderDefinition,
} from '@print-an-agent/model-invocation-core';
import { createHttpTextEmbedder } from '@print-an-agent/model-invocation-embedding-http';

const endpoint = process.argv[2];
if (endpoint === undefined) throw new Error('A loopback fixture endpoint is required');
const signal = new AbortController().signal;

// A program consumes only this narrow capability; it never constructs a generation Actor.
async function query(capability: TextEmbeddingCapability) {
  return capability.embed({
    task: EMBEDDING_TASK.QUERY,
    inputs: [{ id: 'query', text: 'question 🐈' }],
    signal,
  });
}

const http = createHttpTextEmbedder({
  config: {
    endpoint,
    provider: 'public-fixture',
    model: 'test-embedding',
    modelRef: 'fixture:weights-immutable-1',
    dimensions: 2,
    authentication: { kind: 'keyless' },
    limits: { maxBatchSize: 4, maxInputUtf8Bytes: 1024, maxBatchUtf8Bytes: 4096 },
    maxResponseBytes: 4096,
    sendDimensions: false,
  },
});

// Test-only asymmetric encoding demonstrates that recipes belong to the implementation.
const definition: TextEmbedderDefinition = {
  representation: {
    modelRef: 'fixture:weights-immutable-1',
    dimensions: 2,
    preprocessingRef: 'fixture:identity',
    documentRecipeRef: 'fixture:document-axis-1',
    queryRecipeRef: 'fixture:query-axis-1',
    outputTransformRef: 'fixture:identity',
  },
  limits: { maxBatchSize: 4, maxInputUtf8Bytes: 1024, maxBatchUtf8Bytes: 4096 },
  embed: ({ task, inputs }) =>
    Promise.resolve(
      inputs.map(({ id, text }) => ({
        id,
        vector: task === EMBEDDING_TASK.DOCUMENT ? [text.length, 0] : [0, text.length],
      }))
    ),
};
const asymmetric = createTextEmbedder(definition);
const changedRecipe = createTextEmbedder({
  ...definition,
  representation: { ...definition.representation, queryRecipeRef: 'fixture:query-axis-2' },
});

process.stdout.write(
  JSON.stringify({
    http: await query(http),
    asymmetric: await query(asymmetric),
    document: await asymmetric.embed({
      task: EMBEDDING_TASK.DOCUMENT,
      inputs: [{ id: 'document', text: 'question 🐈' }],
      signal,
    }),
    recipeChangesIdentity:
      changedRecipe.descriptor.representationRef !== asymmetric.descriptor.representationRef,
  })
);
