import { expect, it, vi } from 'vitest';
import { createTextEmbedder, EMBEDDING_TASK } from '../../src/index.js';
import { embeddingDefinition, embeddingRequest } from '../support/embedding.js';

it('calls a standalone capability and reconstructs input order from explicit result IDs', async () => {
  const embedder = createTextEmbedder({
    ...embeddingDefinition(),
    embed: () =>
      Promise.resolve([
        { id: 'second', vector: [0, 2] },
        { id: 'first', vector: [1, 0] },
      ]),
  });
  const result = await embedder.embed({
    ...embeddingRequest(),
    inputs: [
      { id: 'first', text: 'document' },
      { id: 'second', text: 'another document' },
    ],
  });
  expect(result).toEqual({
    representationRef: embedder.descriptor.representationRef,
    task: EMBEDDING_TASK.DOCUMENT,
    embeddings: [
      { id: 'first', vector: [1, 0] },
      { id: 'second', vector: [0, 2] },
    ],
  });
});

it('expresses asymmetric recipes without requiring a chat Actor or a consumer-added prefix', async () => {
  const encode = vi.fn((task: string, text: string) =>
    Promise.resolve(task === EMBEDDING_TASK.DOCUMENT ? [text.length, 0] : [0, text.length])
  );
  const embedder = createTextEmbedder({
    ...embeddingDefinition(),
    embed: async ({ task, inputs }) =>
      Promise.all(inputs.map(async ({ id, text }) => ({ id, vector: await encode(task, text) }))),
  });
  const document = await embedder.embed(embeddingRequest());
  const query = await embedder.embed({ ...embeddingRequest(), task: EMBEDDING_TASK.QUERY });
  expect(document.representationRef).toBe(query.representationRef);
  expect(document.embeddings[0]?.vector).toEqual([5, 0]);
  expect(query.embeddings[0]?.vector).toEqual([0, 5]);
  expect(encode).toHaveBeenNthCalledWith(1, EMBEDDING_TASK.DOCUMENT, 'hello');
  expect(encode).toHaveBeenNthCalledWith(2, EMBEDDING_TASK.QUERY, 'hello');
});

it('copies and freezes bindings, invocation input and result buffers', async () => {
  const definition = embeddingDefinition();
  const vector = [0, 0];
  const embedder = createTextEmbedder({
    ...definition,
    embed(request) {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.inputs)).toBe(true);
      expect(Object.isFrozen(request.inputs[0])).toBe(true);
      return Promise.resolve([{ id: 'first', vector }]);
    },
  });
  Object.defineProperty(definition.representation, 'modelRef', { value: 'different:version' });
  const result = await embedder.embed(embeddingRequest());
  vector[0] = 42;
  expect(embedder.descriptor.representation.modelRef).toBe('fixture:weights-1');
  expect(result.embeddings[0]?.vector).toEqual([0, 0]);
  expect(Object.isFrozen(embedder.descriptor.representation)).toBe(true);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.embeddings[0]?.vector)).toBe(true);
});

it('preserves all well-formed Unicode and whitespace without implicit preprocessing', async () => {
  const embed = vi.fn(embeddingDefinition().embed);
  const embedder = createTextEmbedder({ ...embeddingDefinition(), embed });
  const text = '  e\u0301 中文 🐈\n\u0000';
  await embedder.embed({ ...embeddingRequest(), inputs: [{ id: 'first', text }] });
  expect(embed.mock.calls[0]?.[0].inputs[0]?.text).toBe(text);
});
