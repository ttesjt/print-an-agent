import { expect, it, vi } from 'vitest';
import {
  EMBEDDING_TASK,
  type ProviderCredentialResolver,
} from '@print-an-agent/model-invocation-core';
import { createHttpTextEmbedder } from '../../src/index.js';
import { embeddingServer, httpConfig, wireResponse } from '../support/server.js';

const request = (signal = new AbortController().signal) => ({
  task: EMBEDDING_TASK.QUERY,
  inputs: [{ id: 'query', text: 'hello' }],
  signal,
});
const config = (endpoint = 'https://example.test/embeddings') => ({
  ...httpConfig(endpoint),
  authentication: { kind: 'credential-reference' as const, credentialRef: 'fixture:key' },
});

it('sends the single validated snapshot and resolves fresh credentials on each call', async () => {
  const headers: (string | undefined)[] = [];
  const server = await embeddingServer((incoming, response) => {
    headers.push(incoming.headers.authorization);
    response.end(JSON.stringify(wireResponse()));
  });
  try {
    let typeReads = 0,
      keyReads = 0,
      calls = 0;
    const embedder = createHttpTextEmbedder({
      config: config(server.endpoint),
      credentialResolver: {
        resolve: () => {
          calls++;
          let localKeyReads = 0;
          return Promise.resolve({
            get type() {
              typeReads++;
              return 'api-key' as const;
            },
            get apiKey() {
              keyReads++;
              return ++localKeyReads === 1 ? `fixture-${calls}` : '';
            },
          });
        },
      },
    });
    await embedder.embed(request());
    await embedder.embed(request());
    expect(headers).toEqual(['Bearer fixture-1', 'Bearer fixture-2']);
    expect({ calls, typeReads, keyReads }).toEqual({ calls: 2, typeReads: 2, keyReads: 2 });
  } finally {
    await server.close();
  }
});

it.each(['', 'line\rbreak', 'line\nbreak', 42])(
  'rejects the invalid first API key without a later read or fetch: %j',
  async (first) => {
    let reads = 0;
    const fetch = vi.fn<typeof globalThis.fetch>();
    // Exercise an untyped port without pretending its output satisfies the public contract.
    const options: unknown = {
      config: config(),
      fetch,
      credentialResolver: {
        resolve: () =>
          Promise.resolve({
            type: 'api-key',
            get apiKey() {
              return ++reads === 1 ? first : 'later-valid';
            },
          }),
      },
    };
    const embedder: unknown = Reflect.apply(createHttpTextEmbedder, undefined, [options]);
    if (
      typeof embedder !== 'object' ||
      embedder === null ||
      !('embed' in embedder) ||
      typeof embedder.embed !== 'function'
    )
      throw new Error('Expected capability');
    await expect(Reflect.apply(embedder.embed, embedder, [request()])).rejects.toMatchObject({
      code: 'EMBEDDING_PROVIDER_FAILED',
      cause: { code: 'MODEL_CREDENTIAL_RESOLUTION_FAILED' },
    });
    expect(reads).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  }
);

it.each(['type', 'apiKey'])(
  'classifies a throwing %s getter and retains its cause',
  async (field) => {
    const cause = new Error('private resolver detail');
    const credential = { type: 'api-key' as const, apiKey: 'fixture' };
    Object.defineProperty(credential, field, {
      get() {
        throw cause;
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>();
    const embedder = createHttpTextEmbedder({
      config: config(),
      fetch,
      credentialResolver: { resolve: () => Promise.resolve(credential) },
    });
    await expect(embedder.embed(request())).rejects.toMatchObject({
      code: 'EMBEDDING_PROVIDER_FAILED',
      cause: { code: 'MODEL_CREDENTIAL_RESOLUTION_FAILED', cause },
    });
    expect(fetch).not.toHaveBeenCalled();
  }
);

it('captures the resolver method once and preserves its receiver', async () => {
  let reads = 0;
  const owner = {
    key: 'receiver-key',
    get resolve(): ProviderCredentialResolver['resolve'] {
      reads++;
      if (reads > 1) throw new Error('Resolver method was reread');
      return function (this: { readonly key: string }) {
        return Promise.resolve({ type: 'api-key', apiKey: this.key });
      };
    },
  };
  const headers: (string | null)[] = [];
  const embedder = createHttpTextEmbedder({
    config: config(),
    credentialResolver: owner,
    fetch: (_url, init) => {
      headers.push(new Headers(init?.headers).get('authorization'));
      return Promise.resolve(Response.json(wireResponse()));
    },
  });
  await embedder.embed(request());
  expect(headers).toEqual(['Bearer receiver-key']);
  expect(reads).toBe(1);
});

it('retains missing, resolver failure and pre-cancellation identities', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const failure = new Error('resolver failed');
  const unavailable = createHttpTextEmbedder({
    config: config(),
    fetch,
    credentialResolver: { resolve: () => Promise.resolve(undefined) },
  });
  await expect(unavailable.embed(request())).rejects.toMatchObject({
    code: 'EMBEDDING_PROVIDER_FAILED',
    cause: { code: 'MODEL_CREDENTIAL_NOT_FOUND' },
  });
  const failed = createHttpTextEmbedder({
    config: config(),
    fetch,
    credentialResolver: { resolve: () => Promise.reject(failure) },
  });
  await expect(failed.embed(request())).rejects.toMatchObject({
    code: 'EMBEDDING_PROVIDER_FAILED',
    cause: { code: 'MODEL_CREDENTIAL_RESOLUTION_FAILED', cause: failure },
  });
  const controller = new AbortController();
  controller.abort(failure);
  await expect(unavailable.embed(request(controller.signal))).rejects.toMatchObject({
    code: 'EMBEDDING_INVOCATION_CANCELLED',
    cause: failure,
  });
  expect(fetch).not.toHaveBeenCalled();
});
