import { afterEach, expect, it, vi } from 'vitest';
import { createTextEmbedder } from '../../../src/index.js';
import { embeddingDefinition, embeddingRequest } from '../../support/embedding.js';

afterEach(() => vi.useRealTimers());

it('does not call a borrowed implementation on pre-cancelled input', async () => {
  const reason = new Error('caller cancelled');
  const embed = vi.fn(embeddingDefinition().embed);
  const embedder = createTextEmbedder({ ...embeddingDefinition(), embed });
  await expect(embedder.embed(embeddingRequest(AbortSignal.abort(reason)))).rejects.toMatchObject({
    code: 'EMBEDDING_INVOCATION_CANCELLED',
    cause: reason,
  });
  expect(embed).not.toHaveBeenCalled();
});

it('times out cooperatively, does not abort the parent and cleans up its timer', async () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  let actualSignal: AbortSignal | undefined;
  const embedder = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: 10 },
    embed: ({ signal }) => {
      actualSignal = signal;
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    },
  });
  const result = embedder.embed(embeddingRequest(parent.signal));
  const checked = expect(result).rejects.toMatchObject({ code: 'EMBEDDING_INVOCATION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(10);
  await checked;
  expect(actualSignal?.aborted).toBe(true);
  expect(parent.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves parent cancellation ownership and clears its later local deadline', async () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  const reason = new DOMException('parent deadline', 'TimeoutError');
  const embedder = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: 100 },
    embed: ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      }),
  });
  const result = embedder.embed(embeddingRequest(parent.signal));
  const checked = expect(result).rejects.toMatchObject({
    code: 'EMBEDDING_INVOCATION_CANCELLED',
    cause: reason,
  });
  parent.abort(reason);
  await checked;
  expect(vi.getTimerCount()).toBe(0);
});

it('does not return success when implementation ignores cancellation and settles late', async () => {
  vi.useFakeTimers();
  const embedder = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: 10 },
    embed: () =>
      new Promise((resolve) => {
        setTimeout(() => resolve([{ id: 'first', vector: [1, 0] }]), 20);
      }),
  });
  const result = embedder.embed(embeddingRequest());
  const checked = expect(result).rejects.toMatchObject({ code: 'EMBEDDING_INVOCATION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(20);
  await checked;
});

it('uses no timer by default and keeps provider failure distinct with its original cause', async () => {
  vi.useFakeTimers();
  const cause = new Error('backend diagnostic');
  const embedder = createTextEmbedder({
    ...embeddingDefinition(),
    embed: () => Promise.reject(cause),
  });
  await expect(embedder.embed(embeddingRequest())).rejects.toMatchObject({
    code: 'EMBEDDING_PROVIDER_FAILED',
    cause,
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('clears the owned deadline on successful completion', async () => {
  vi.useFakeTimers();
  const embedder = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: 10 },
  });
  await embedder.embed(embeddingRequest());
  expect(vi.getTimerCount()).toBe(0);
});
