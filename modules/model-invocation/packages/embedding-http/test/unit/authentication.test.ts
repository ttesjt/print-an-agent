import { expect, it, vi } from 'vitest';
import {
  EMBEDDING_TASK,
  defineProviderModelReference,
} from '@print-an-agent/model-invocation-core';
import { createHttpTextEmbedder } from '../../src/index.js';
import { httpConfig } from '../support/configuration.js';
import { wireResponse } from '../support/wire-response.js';
import { resolveEmbeddingAuthorization } from '../../src/authentication.js';

const signal = new AbortController().signal;
const reference = defineProviderModelReference({
  provider: 'fixture',
  model: 'fixture',
  credentialRef: 'fixture:key',
});

it('keeps keyless calls independent of the borrowed resolver', async () => {
  const resolve = vi.fn();
  const keyless = defineProviderModelReference({ provider: 'fixture', model: 'fixture' });
  expect(await resolveEmbeddingAuthorization(keyless, { resolve }, signal)).toBeUndefined();
  expect(resolve).not.toHaveBeenCalled();
});

it('retains accepted inherited and extended credential fields', async () => {
  class Credential {
    get type() {
      return 'api-key' as const;
    }
    get apiKey() {
      return 'fixture';
    }
  }
  const extended = Object.defineProperty(
    { type: 'api-key' as const, apiKey: 'fixture', extra: true, [Symbol('extra')]: true },
    'hidden',
    { value: true }
  );
  for (const credential of [new Credential(), extended]) {
    expect(
      await resolveEmbeddingAuthorization(
        reference,
        { resolve: () => Promise.resolve(credential) },
        signal
      )
    ).toBe('Bearer fixture');
  }
});

it('retains cancellation after an in-flight resolver settles', async () => {
  const controller = new AbortController();
  const reason = new Error('caller cancellation');
  await expect(
    resolveEmbeddingAuthorization(
      reference,
      {
        resolve: () => {
          controller.abort(reason);
          return Promise.resolve({ type: 'api-key', apiKey: 'fixture' });
        },
      },
      controller.signal
    )
  ).rejects.toBe(reason);
});

const endpoint = 'http://127.0.0.1:1234/embedding';

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
