import { afterEach, expect, it, vi } from 'vitest';
import { createTextEmbedder, EMBEDDING_TASK } from '../../src/index.js';
import { embeddingDefinition, embeddingRequest } from '../support/embedding.js';

afterEach(() => vi.useRealTimers());

it('isolates local deadlines for concurrent invocations of a shared borrowed implementation', async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  const capability = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: 10 },
    embed: ({ inputs, signal }) => {
      signals.push(signal);
      if (inputs[0]?.id === 'slow')
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('stopped by caller')), {
            once: true,
          });
        });
      return Promise.resolve(inputs.map(({ id }) => ({ id, vector: [1, 0] })));
    },
  });
  const parent = new AbortController();
  const slow = capability.embed({
    ...embeddingRequest(parent.signal),
    inputs: [{ id: 'slow', text: 'slow' }],
  });
  const rejected = expect(slow).rejects.toMatchObject({ code: 'EMBEDDING_INVOCATION_TIMEOUT' });
  await expect(
    capability.embed({ ...embeddingRequest(parent.signal), task: EMBEDDING_TASK.QUERY })
  ).resolves.toMatchObject({
    embeddings: [{ id: 'first', vector: [1, 0] }],
  });
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  expect(signals[0]?.aborted).toBe(true);
  expect(signals[1]?.aborted).toBe(false);
  expect(parent.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('snapshots inputs before awaiting execution and does not reuse previous result storage', async () => {
  const settled = Promise.withResolvers<void>();
  const vectors = [1, 0];
  const firstRequest = embeddingRequest();
  let observedText: string | undefined;
  const capability = createTextEmbedder({
    ...embeddingDefinition(),
    embed: async ({ inputs }) => {
      await settled.promise;
      observedText = inputs[0]?.text;
      return [{ id: 'first', vector: vectors }];
    },
  });
  const pending = capability.embed(firstRequest);
  Object.defineProperty(firstRequest.inputs[0], 'text', { value: 'changed by caller' });
  settled.resolve();
  const first = await pending;
  expect(observedText).toBe('hello');
  vectors[0] = 2;
  const second = await capability.embed(embeddingRequest());
  expect(first.embeddings[0]?.vector).toEqual([1, 0]);
  expect(second.embeddings[0]?.vector).toEqual([2, 0]);
});

it('rejects a real synchronous overrun even when the event loop never dispatches its timer', async () => {
  const capability = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: 5 },
    embed: () => {
      const finish = performance.now() + 20;
      while (performance.now() < finish) {
        // Bounded CPU fixture: no timer callback can execute during this synchronous work.
      }
      return Promise.resolve([{ id: 'first', vector: [1, 0] }]);
    },
  });
  await expect(capability.embed(embeddingRequest())).rejects.toMatchObject({
    code: 'EMBEDDING_INVOCATION_TIMEOUT',
  });
});
