import { afterEach, expect, it, vi } from 'vitest';
import { EMBEDDING_TASK } from '@print-an-agent/model-invocation-core';
import { createHttpTextEmbedder } from '../../src/index.js';
import { embeddingServer, readRequest } from '../support/server.js';
import { httpConfig } from '../support/configuration.js';
import { wireResponse } from '../support/wire-response.js';

const closeServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closeServers.splice(0).map((close) => close()));
});

const request = () => ({
  task: EMBEDDING_TASK.DOCUMENT,
  inputs: [{ id: 'first', text: 'hello' }],
  signal: new AbortController().signal,
});

it('uses the exact configured endpoint and keyless float protocol, associates reversed indices', async () => {
  const received: unknown[] = [];
  const server = await embeddingServer(async (incoming, response) => {
    received.push({
      url: incoming.url,
      method: incoming.method,
      auth: incoming.headers.authorization,
      body: await readRequest(incoming),
    });
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        ...wireResponse(),
        data: [
          { object: 'embedding', index: 1, embedding: [0, 2] },
          { object: 'embedding', index: 0, embedding: [1, 0] },
        ],
      })
    );
  });
  closeServers.push(server.close);
  const embedder = createHttpTextEmbedder({ config: httpConfig(server.endpoint) });
  const result = await embedder.embed({
    ...request(),
    inputs: [
      { id: 'first', text: 'e\u0301 🐈' },
      { id: 'second', text: '中文' },
    ],
  });
  expect(received).toEqual([
    {
      url: '/custom/embeddings',
      method: 'POST',
      auth: undefined,
      body: { model: 'test-embedding', input: ['e\u0301 🐈', '中文'], encoding_format: 'float' },
    },
  ]);
  expect(result.embeddings).toEqual([
    { id: 'first', vector: [1, 0] },
    { id: 'second', vector: [0, 2] },
  ]);
});

it('resolves formal credentials with the execution signal and sends explicitly configured dimensions', async () => {
  let headers: string | undefined;
  let body: unknown;
  const server = await embeddingServer(async (incoming, response) => {
    headers = incoming.headers.authorization;
    body = await readRequest(incoming);
    response.end(JSON.stringify(wireResponse()));
  });
  closeServers.push(server.close);
  const resolve = vi.fn(() => Promise.resolve({ type: 'api-key', apiKey: 'fixture-key' } as const));
  const input = request();
  const embedder = createHttpTextEmbedder({
    config: {
      ...httpConfig(server.endpoint),
      sendDimensions: true,
      authentication: { kind: 'credential-reference', credentialRef: 'fixture:embedding-key' },
    },
    credentialResolver: { resolve },
  });
  await embedder.embed(input);
  expect(resolve).toHaveBeenCalledWith({
    reference: 'fixture:embedding-key',
    provider: 'test-provider',
    signal: input.signal,
  });
  expect(headers).toBe('Bearer fixture-key');
  expect(body).toMatchObject({ dimensions: 2 });
});

it('supports document and query symmetrically without inserting chat or task-specific fields', async () => {
  const received: unknown[] = [];
  const server = await embeddingServer(async (incoming, response) => {
    received.push(await readRequest(incoming));
    response.end(JSON.stringify(wireResponse()));
  });
  closeServers.push(server.close);
  const embedder = createHttpTextEmbedder({ config: httpConfig(server.endpoint) });
  const document = await embedder.embed(request());
  const query = await embedder.embed({ ...request(), task: EMBEDDING_TASK.QUERY });
  expect(received[0]).toEqual(received[1]);
  expect(query.representationRef).toBe(document.representationRef);
  expect(query.embeddings).toEqual(document.embeddings);
});

it.each([
  ['missing', { ...wireResponse(), data: [] }],
  ['extra', { ...wireResponse(), data: [...wireResponse().data, ...wireResponse().data] }],
  [
    'out-of-range',
    { ...wireResponse(), data: [{ object: 'embedding', index: 1, embedding: [1, 0] }] },
  ],
  [
    'fractional',
    { ...wireResponse(), data: [{ object: 'embedding', index: 0.5, embedding: [1, 0] }] },
  ],
  ['dimension', { ...wireResponse(), data: [{ object: 'embedding', index: 0, embedding: [1] }] }],
  [
    'non-number',
    { ...wireResponse(), data: [{ object: 'embedding', index: 0, embedding: ['1', 0] }] },
  ],
  ['different-model', { ...wireResponse(), model: 'silently-switched-model' }],
  ['wrong-kind', { ...wireResponse(), object: 'other' }],
])('rejects %s responses without accepting partial success', async (_, payload) => {
  const server = await embeddingServer((_incoming, response) => {
    response.end(JSON.stringify(payload));
  });
  closeServers.push(server.close);
  const embedder = createHttpTextEmbedder({ config: httpConfig(server.endpoint) });
  await expect(embedder.embed(request())).rejects.toMatchObject({
    code: 'EMBEDDING_RESPONSE_INVALID',
  });
});

it('rejects duplicate wire indices in a correctly sized batch', async () => {
  const server = await embeddingServer((_incoming, response) => {
    response.end(
      JSON.stringify({
        ...wireResponse(),
        data: [...wireResponse().data, ...wireResponse().data],
      })
    );
  });
  closeServers.push(server.close);
  const embedder = createHttpTextEmbedder({ config: httpConfig(server.endpoint) });
  await expect(
    embedder.embed({
      ...request(),
      inputs: [
        { id: 'a', text: 'first' },
        { id: 'b', text: 'second' },
      ],
    })
  ).rejects.toMatchObject({ code: 'EMBEDDING_RESPONSE_INVALID' });
});

it.each([
  ['http', 429, 'private provider diagnostic', 'EMBEDDING_PROVIDER_FAILED'],
  ['json', 200, 'not JSON: private text', 'EMBEDDING_RESPONSE_INVALID'],
  ['oversize', 200, ' '.repeat(5000), 'EMBEDDING_RESPONSE_INVALID'],
  [
    'non-finite',
    200,
    '{"object":"list","model":"test-embedding","data":[{"object":"embedding","index":0,"embedding":[1e999,0]}]}',
    'EMBEDDING_RESPONSE_INVALID',
  ],
])('keeps %s failure stable and its public message safe', async (_, status, body, code) => {
  const server = await embeddingServer((_incoming, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(body);
  });
  closeServers.push(server.close);
  const embedder = createHttpTextEmbedder({ config: httpConfig(server.endpoint) });
  let error: unknown;
  try {
    await embedder.embed(request());
  } catch (cause: unknown) {
    error = cause;
  }
  expect(error).toMatchObject({ code });
  expect(error).toBeInstanceOf(Error);
  if (error instanceof Error) expect(error.message).not.toContain('private');
});

it('does not follow endpoint redirects or silently change execution targets', async () => {
  const server = await embeddingServer((_incoming, response) => {
    response.writeHead(307, { Location: '/different' }).end();
  });
  closeServers.push(server.close);
  const embedder = createHttpTextEmbedder({ config: httpConfig(server.endpoint) });
  await expect(embedder.embed(request())).rejects.toMatchObject({
    code: 'EMBEDDING_PROVIDER_FAILED',
  });
});
