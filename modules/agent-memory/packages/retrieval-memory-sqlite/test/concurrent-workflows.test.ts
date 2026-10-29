import { createTextEmbedder } from '@ta-agent/model-invocation-core';
import {
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  findRetrievalCommit,
} from '@ta-agent/retrieval-memory';
import { expect, it, vi } from 'vitest';
import { fixture } from './support/fixture.js';
it('cancels one in-flight model call while another Session-like Space proceeds on shared resources', async () => {
  const f = await fixture();
  await f.create();
  await f.create('other');
  const original = f.resources.embeddings.resolve();
  let admitted: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  const embedder = createTextEmbedder({
    representation: original.descriptor.representation,
    limits: original.descriptor.limits,
    embed: async (request) => {
      if (request.inputs.some((input) => input.text === 'slow')) {
        admitted();
        await new Promise<void>((_resolve, reject) =>
          request.signal.addEventListener('abort', () => reject(new Error('cancelled wait')), {
            once: true,
          })
        );
      }
      return (await original.embed(request)).embeddings;
    },
  });
  const resources = createRetrievalWorkflowResources({
    ...f.resources,
    embeddings: { resolve: () => embedder },
  });
  const w = createRetrievalMemoryBundle({ resources }).workflows;
  const abort = new AbortController();
  const waiting = w.ingest
    .run({ input: { memoryId: 'space', requestId: 'slow', content: 'slow' }, signal: abort.signal })
    .catch((cause: unknown) => cause);
  await entered;
  const other = await w.ingest.run({
    input: { memoryId: 'other', requestId: 'fast', content: 'aligned' },
  });
  expect(other.status).toBe('committed');
  abort.abort();
  expect(findRetrievalCommit(await waiting)).toEqual({ status: 'not-committed' });
  expect((await f.backend.inspect('space'))?.sequence).toBe(0);
  expect((await f.backend.inspect('other'))?.sequence).toBe(1);
});
it('provides an optional owned deadline without a default model timeout or abandoned work', async () => {
  const f = await fixture();
  await f.create();
  const original = f.resources.embeddings.resolve();
  let cleaned = false;
  let admitted = () => {};
  const entered = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  const embedder = createTextEmbedder({
    representation: original.descriptor.representation,
    limits: original.descriptor.limits,
    embed: (request) =>
      new Promise((_resolve, reject) => {
        admitted();
        request.signal.addEventListener(
          'abort',
          () => {
            cleaned = true;
            reject(new Error('deadline reached'));
          },
          { once: true }
        );
      }),
  });
  const resources = createRetrievalWorkflowResources(
    { ...f.resources, embeddings: { resolve: () => embedder } },
    { execution: { timeoutMilliseconds: 20 } }
  );
  const w = createRetrievalMemoryBundle({ resources }).workflows;
  // Deadline covers preparation too. Prove cleanup of an admitted model call without depending
  // on SQLite/worker scheduling fitting into a 20ms wall-clock window on a loaded machine.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const pending = w.ingest.run({
      input: { memoryId: 'space', requestId: 'timed', content: 'text' },
    });
    const failed = expect(pending).rejects.toMatchObject({
      code: 'OPERATION_TIMED_OUT',
      commit: { status: 'not-committed' },
    });
    await Promise.race([entered, pending]);
    await vi.advanceTimersByTimeAsync(20);
    await failed;
  } finally {
    vi.useRealTimers();
  }
  expect(cleaned).toBe(true);
  expect((await f.backend.inspect('space'))?.sequence).toBe(0);
});
