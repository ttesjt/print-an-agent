import { expect, it } from 'vitest';
import { EMBEDDING_TASK } from '@print-an-agent/model-invocation-core';
import { createHttpTextEmbedder } from '../../../src/index.js';
import { httpConfig } from '../../support/configuration.js';
import { wireResponse } from '../../support/wire-response.js';

const endpoint = 'http://127.0.0.1:1234/embedding';

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
