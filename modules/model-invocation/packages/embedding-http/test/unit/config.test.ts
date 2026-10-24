import { expect, it, vi } from 'vitest';
import { EMBEDDING_TASK } from '@ta-agent/model-invocation-core';
import { createHttpTextEmbedder } from '../../src/index.js';
import { httpConfig, wireResponse } from '../support/server.js';

const endpoint = 'http://127.0.0.1:1234/embedding';

function buildUnknown(options: unknown): void {
  Reflect.apply(createHttpTextEmbedder, undefined, [options]);
}

it.each([
  { extra: true },
  { endpoint: 'file:///tmp/embedding' },
  { endpoint: 'https://name:secret@example.test/embedding' },
  { endpoint: 'https://example.test/embedding?key=secret' },
  { endpoint: 'https://example.test/embedding#fragment' },
  { sendDimensions: undefined },
  { sendDimensions: 'true' },
  { maxResponseBytes: 0 },
  { maxResponseBytes: Infinity },
  { dimensions: 0 },
  { modelRef: undefined },
  { authentication: { kind: 'ambient' } },
  { authentication: { kind: 'keyless', credentialRef: 'secret' } },
  { authentication: { kind: 'credential-reference' } },
  { authentication: { kind: 'keyless', extra: true } },
  { limits: { maxBatchSize: null } },
])('rejects invalid config %#', (change) => {
  expect(() => buildUnknown({ config: { ...httpConfig(endpoint), ...change } })).toThrow();
});

it('rejects getters and unknown options without executing accessors', () => {
  const getter = vi.fn();
  const config = httpConfig(endpoint);
  Object.defineProperty(config, 'modelRef', { enumerable: true, get: getter });
  expect(() => createHttpTextEmbedder({ config })).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => buildUnknown({ config: httpConfig(endpoint), extra: true })).toThrow();
});

it('requires an explicit resolver for credential-reference authentication', () => {
  expect(() =>
    createHttpTextEmbedder({
      config: {
        ...httpConfig(endpoint),
        authentication: { kind: 'credential-reference', credentialRef: 'key' },
      },
    })
  ).toThrow();
});

it('keeps endpoint, credentials and response limits out of representation identity', () => {
  const original = createHttpTextEmbedder({ config: httpConfig(endpoint) });
  const changed = createHttpTextEmbedder({
    config: {
      ...httpConfig('http://127.0.0.1:5678/other'),
      maxResponseBytes: 8192,
      authentication: { kind: 'credential-reference', credentialRef: 'another-key' },
    },
    credentialResolver: { resolve: () => Promise.resolve(undefined) },
  });
  expect(original.descriptor.representationRef).toBe(changed.descriptor.representationRef);
});

it('binds explicit and model-default dimension request modes to different representation identities', async () => {
  const makeEmbedder = (sendDimensions: boolean) =>
    createHttpTextEmbedder({
      config: { ...httpConfig(endpoint), sendDimensions },
      fetch: (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected JSON request');
        const body: unknown = JSON.parse(init.body);
        const explicit = typeof body === 'object' && body !== null && 'dimensions' in body;
        return Promise.resolve(
          Response.json({
            ...wireResponse(),
            data: [{ object: 'embedding', index: 0, embedding: explicit ? [0, 1] : [1, 0] }],
          })
        );
      },
    });
  const implicit = makeEmbedder(false);
  const explicit = makeEmbedder(true);
  const request = {
    task: EMBEDDING_TASK.QUERY,
    inputs: [{ id: 'query', text: 'hello' }],
    signal: new AbortController().signal,
  };
  const implicitResult = await implicit.embed(request);
  const explicitResult = await explicit.embed(request);
  expect(implicitResult.embeddings[0]?.vector).toEqual([1, 0]);
  expect(explicitResult.embeddings[0]?.vector).toEqual([0, 1]);
  expect(explicitResult.representationRef).not.toBe(implicitResult.representationRef);
  expect(explicit.descriptor.representation.documentRecipeRef).not.toBe(
    implicit.descriptor.representation.documentRecipeRef
  );
  expect(explicit.descriptor.representation.queryRecipeRef).not.toBe(
    implicit.descriptor.representation.queryRecipeRef
  );
  expect(makeEmbedder(true).descriptor.representationRef).toBe(explicitResult.representationRef);
});

it.each(['missing', 'throw', 'malformed'])(
  'does not issue HTTP calls when credentials are %s',
  async (kind) => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(wireResponse()))
    );
    const resolver = {
      resolve: () =>
        kind === 'throw'
          ? Promise.reject(new Error('private-key-detail'))
          : Promise.resolve(undefined),
    };
    if (kind === 'malformed')
      Object.defineProperty(resolver, 'resolve', {
        value: () => Promise.resolve({ type: 'api-key', apiKey: '' }),
      });
    const embedder = createHttpTextEmbedder({
      config: {
        ...httpConfig(endpoint),
        authentication: { kind: 'credential-reference', credentialRef: 'key' },
      },
      credentialResolver: resolver,
      fetch,
    });
    await expect(
      embedder.embed({
        task: EMBEDDING_TASK.QUERY,
        inputs: [{ id: 'query', text: 'hello' }],
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ code: 'EMBEDDING_PROVIDER_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  }
);

it('rejects unsupported empty wire text without calling the network', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const embedder = createHttpTextEmbedder({ config: httpConfig(endpoint), fetch });
  await expect(
    embedder.embed({
      task: EMBEDDING_TASK.DOCUMENT,
      inputs: [{ id: 'empty', text: '' }],
      signal: new AbortController().signal,
    })
  ).rejects.toMatchObject({ code: 'EMBEDDING_INPUT_INVALID' });
  expect(fetch).not.toHaveBeenCalled();
});
