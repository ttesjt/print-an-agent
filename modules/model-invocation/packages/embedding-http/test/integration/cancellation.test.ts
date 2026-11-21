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

it('timer-driven cancellation reaches real HTTP work without cancelling another shared-client request', async () => {
  const started = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  const server = await embeddingServer(async (incoming, response) => {
    const body = await readRequest(incoming);
    if (typeof body !== 'object' || body === null || !('input' in body))
      throw new Error('Expected input');
    if (Array.isArray(body.input) && body.input[0] === 'wait') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.flushHeaders();
      response.once('close', () => disconnected.resolve());
      started.resolve();
      return;
    }
    response.end(JSON.stringify(wireResponse()));
  });
  closeServers.push(server.close);
  const sharedClient = { fetch: globalThis.fetch, close: vi.fn() };
  const embedder = createHttpTextEmbedder({
    config: httpConfig(server.endpoint),
    fetch: sharedClient.fetch,
  });
  const cancelled = new AbortController();
  const reason = new Error('cancel only the waiting request');
  const slow = embedder.embed({
    task: EMBEDDING_TASK.DOCUMENT,
    inputs: [{ id: 'slow', text: 'wait' }],
    signal: cancelled.signal,
  });
  const checked = expect(slow).rejects.toMatchObject({
    code: 'EMBEDDING_INVOCATION_CANCELLED',
    cause: reason,
  });
  await started.promise;
  const fast = embedder.embed({
    task: EMBEDDING_TASK.QUERY,
    inputs: [{ id: 'fast', text: 'finish' }],
    signal: new AbortController().signal,
  });
  const timer = setTimeout(() => cancelled.abort(reason), 5);
  try {
    expect((await fast).embeddings).toEqual([{ id: 'fast', vector: [1, 0] }]);
    await checked;
    await disconnected.promise;
  } finally {
    clearTimeout(timer);
  }
  expect(sharedClient.close).not.toHaveBeenCalled();
  // The same borrowed client remains usable after cancellation.
  await expect(
    embedder.embed({
      task: EMBEDDING_TASK.QUERY,
      inputs: [{ id: 'after', text: 'finish' }],
      signal: new AbortController().signal,
    })
  ).resolves.toMatchObject({ embeddings: [{ id: 'after', vector: [1, 0] }] });
});
