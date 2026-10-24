import { expect, it, vi } from 'vitest';
import { createTextEmbedder } from '../../src/index.js';
import { embeddingDefinition, embeddingRequest } from '../support/embedding.js';

it.each([
  ['modelRef', 'fixture:weights-2'],
  ['dimensions', 3],
  ['preprocessingRef', 'fixture:preprocess-2'],
  ['documentRecipeRef', 'fixture:document-2'],
  ['queryRecipeRef', 'fixture:query-2'],
  ['outputTransformRef', 'fixture:transform-2'],
])('includes %s in representation identity', (field, value) => {
  const definition = embeddingDefinition();
  const original = createTextEmbedder(definition).descriptor;
  const changed = createTextEmbedder({
    ...definition,
    representation: { ...definition.representation, [field]: value },
  }).descriptor;
  expect(changed.representationRef).not.toBe(original.representationRef);
});

it('does not include operational limits or property insertion order in representation identity', () => {
  const definition = embeddingDefinition();
  const original = createTextEmbedder(definition).descriptor;
  const { representation } = definition;
  const changed = createTextEmbedder({
    ...definition,
    representation: {
      outputTransformRef: representation.outputTransformRef,
      queryRecipeRef: representation.queryRecipeRef,
      documentRecipeRef: representation.documentRecipeRef,
      preprocessingRef: representation.preprocessingRef,
      dimensions: representation.dimensions,
      modelRef: representation.modelRef,
    },
    limits: { maxBatchSize: 1, maxInputUtf8Bytes: 1, maxBatchUtf8Bytes: 1 },
  }).descriptor;
  expect(changed.representationRef).toBe(original.representationRef);
});

it.each([
  null,
  { ...embeddingDefinition(), extra: true },
  { ...embeddingDefinition(), embed: undefined },
  {
    ...embeddingDefinition(),
    representation: { ...embeddingDefinition().representation, dimensions: 0 },
  },
  {
    ...embeddingDefinition(),
    representation: { ...embeddingDefinition().representation, modelRef: '' },
  },
  { ...embeddingDefinition(), limits: { maxBatchSize: 1 } },
  { ...embeddingDefinition(), limits: { ...embeddingDefinition().limits, maxBatchSize: Infinity } },
  ...[0, -1, Infinity, NaN, 1.5, 2_147_483_648, undefined].map((timeoutMilliseconds) => ({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds },
  })),
])('rejects malformed binding %#', (value: unknown) => {
  let error: unknown;
  try {
    Reflect.apply(createTextEmbedder, undefined, [value]);
  } catch (cause: unknown) {
    error = cause;
  }
  expect(error).toMatchObject({ code: 'EMBEDDING_BINDING_INVALID' });
});

it.each([
  null,
  { ...embeddingRequest(), extra: true },
  { ...embeddingRequest(), task: 'chat' },
  { ...embeddingRequest(), signal: undefined },
  { ...embeddingRequest(), inputs: [] },
  {
    ...embeddingRequest(),
    inputs: [
      { id: 'a', text: 'x' },
      { id: 'a', text: 'y' },
    ],
  },
  { ...embeddingRequest(), inputs: [{ id: 'a', text: '\ud800' }] },
  { ...embeddingRequest(), inputs: [{ id: 'a', text: '\udc00' }] },
  { ...embeddingRequest(), inputs: [{ id: 'a', text: 'x\ud800y' }] },
  { ...embeddingRequest(), inputs: [{ id: 'a', text: 123 }] },
  { ...embeddingRequest(), inputs: [{ id: 'a', text: 'x', extra: true }] },
])('rejects malformed input %# before executing implementation', async (value: unknown) => {
  const embed = vi.fn(embeddingDefinition().embed);
  const embedder = createTextEmbedder({ ...embeddingDefinition(), embed });
  await expect(Reflect.apply(embedder.embed, undefined, [value])).rejects.toMatchObject({
    code: 'EMBEDDING_INPUT_INVALID',
  });
  expect(embed).not.toHaveBeenCalled();
});

it.each([{ maxBatchSize: 1 }, { maxInputUtf8Bytes: 3 }, { maxBatchUtf8Bytes: 7 }])(
  'checks the declared limit %j without truncation',
  async (limits) => {
    const embed = vi.fn(embeddingDefinition().embed);
    const embedder = createTextEmbedder({
      ...embeddingDefinition(),
      limits: { ...embeddingDefinition().limits, ...limits },
      embed,
    });
    await expect(
      embedder.embed({
        ...embeddingRequest(),
        inputs: [
          { id: 'a', text: '🐈' },
          { id: 'b', text: '🐈' },
        ],
      })
    ).rejects.toMatchObject({ code: 'EMBEDDING_INPUT_LIMIT_EXCEEDED' });
    expect(embed).not.toHaveBeenCalled();
  }
);

it.each([false, true])(
  'rejects a forged AbortSignal with shadowed aborted=%s before invoking the implementation',
  async (shadowAborted) => {
    const embed = vi.fn(embeddingDefinition().embed);
    const embedder = createTextEmbedder({ ...embeddingDefinition(), embed });
    const forged: unknown = Object.create(AbortSignal.prototype);
    if (shadowAborted && typeof forged === 'object' && forged !== null) {
      Object.defineProperty(forged, 'aborted', { value: false });
    }
    await expect(
      Reflect.apply(embedder.embed, undefined, [{ ...embeddingRequest(), signal: forged }])
    ).rejects.toMatchObject({
      code: 'EMBEDDING_INPUT_INVALID',
    });
    expect(embed).not.toHaveBeenCalled();
  }
);

it('rejects an oversized batch before enumerating or inspecting its entries', async () => {
  let entryInspections = 0;
  let keyEnumerations = 0;
  const inputs = new Proxy(
    Array.from({ length: 10_000 }, (_, index) => ({ id: `input-${index}`, text: 'x' })),
    {
      ownKeys(target) {
        keyEnumerations++;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        if (property !== 'length') entryInspections++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    }
  );
  const embed = vi.fn(embeddingDefinition().embed);
  const embedder = createTextEmbedder({
    ...embeddingDefinition(),
    limits: { ...embeddingDefinition().limits, maxBatchSize: 1 },
    embed,
  });
  await expect(embedder.embed({ ...embeddingRequest(), inputs })).rejects.toMatchObject({
    code: 'EMBEDDING_INPUT_LIMIT_EXCEEDED',
  });
  expect(keyEnumerations).toBe(0);
  expect(entryInspections).toBe(0);
  expect(embed).not.toHaveBeenCalled();
});

it.each([
  undefined,
  [],
  [
    { id: 'first', vector: [1, 0] },
    { id: 'extra', vector: [1, 0] },
  ],
  [{ id: 'extra', vector: [1, 0] }],
  [{ id: 'first', vector: [1] }],
  [{ id: 'first', vector: [1, 0, 0] }],
  [{ id: 'first', vector: [NaN, 0] }],
  [{ id: 'first', vector: [Infinity, 0] }],
  [{ id: 'first', vector: ['1', 0] }],
  [{ id: 'first', vector: [1, 0], representationRef: 'spoofed' }],
])('rejects malformed implementation result %#', async (result: unknown) => {
  const definition = embeddingDefinition();
  Object.defineProperty(definition, 'embed', { value: () => Promise.resolve(result) });
  await expect(createTextEmbedder(definition).embed(embeddingRequest())).rejects.toMatchObject({
    code: 'EMBEDDING_RESPONSE_INVALID',
  });
});

it('rejects duplicate results even when the result count is correct', async () => {
  const embedder = createTextEmbedder({
    ...embeddingDefinition(),
    embed: () =>
      Promise.resolve([
        { id: 'a', vector: [1, 0] },
        { id: 'a', vector: [2, 0] },
      ]),
  });
  await expect(
    embedder.embed({
      ...embeddingRequest(),
      inputs: [
        { id: 'a', text: 'x' },
        { id: 'b', text: 'y' },
      ],
    })
  ).rejects.toMatchObject({ code: 'EMBEDDING_RESPONSE_INVALID' });
});

it('rejects getters and sparse arrays without executing accessor code', async () => {
  const getter = vi.fn(() => 'secret');
  const request = embeddingRequest();
  Object.defineProperty(request, 'task', { enumerable: true, get: getter });
  const embedder = createTextEmbedder(embeddingDefinition());
  await expect(embedder.embed(request)).rejects.toMatchObject({ code: 'EMBEDDING_INPUT_INVALID' });
  expect(getter).not.toHaveBeenCalled();
  const definition = embeddingDefinition();
  Object.defineProperty(definition, 'embed', {
    value: () => Promise.resolve([{ id: 'first', vector: new Array<unknown>(2) }]),
  });
  await expect(createTextEmbedder(definition).embed(embeddingRequest())).rejects.toMatchObject({
    code: 'EMBEDDING_RESPONSE_INVALID',
  });
});
