import { afterEach, expect, it, vi } from 'vitest';
import { EMBEDDING_TASK } from '@print-an-agent/model-invocation-core';
import { createHttpTextEmbedder } from '../../src/index.js';
import { httpConfig, wireResponse } from '../support/server.js';

afterEach(() => vi.useRealTimers());

const request = (signal: AbortSignal = new AbortController().signal) => ({
  task: EMBEDDING_TASK.QUERY,
  inputs: [{ id: 'query', text: 'hello' }],
  signal,
});

it.each(['status', 'advertised-size', 'streamed-size', 'utf8'])(
  'cleans owned response resources after %s failure',
  async (kind) => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (kind === 'streamed-size') controller.enqueue(new Uint8Array(5000));
        if (kind === 'utf8') {
          controller.enqueue(new Uint8Array([0xff]));
          controller.close();
        }
      },
      cancel,
    });
    const response = new Response(stream, {
      status: kind === 'status' ? 500 : 200,
      headers: kind === 'advertised-size' ? { 'Content-Length': '5000' } : {},
    });
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response));
    const embedder = createHttpTextEmbedder({
      config: httpConfig('https://example.test/embed'),
      fetch,
    });
    await expect(embedder.embed(request())).rejects.toMatchObject({
      code: kind === 'status' ? 'EMBEDDING_PROVIDER_FAILED' : 'EMBEDDING_RESPONSE_INVALID',
    });
    expect(stream.locked).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(kind === 'utf8' ? 0 : 1);
  }
);

it('cancels an accepted response body when its local deadline fires and clears the timer', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ cancel });
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response(stream)));
  const embedder = createHttpTextEmbedder({
    config: httpConfig('https://example.test/embed'),
    fetch,
    invocationPolicy: { timeoutMilliseconds: 10 },
  });
  const result = embedder.embed(request());
  const checked = expect(result).rejects.toMatchObject({ code: 'EMBEDDING_INVOCATION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(10);
  await checked;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(stream.locked).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('retains transport read failures without treating them as malformed model vectors', async () => {
  const cause = new Error('connection reset');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(cause);
    },
  });
  const embedder = createHttpTextEmbedder({
    config: httpConfig('https://example.test/embed'),
    fetch: () => Promise.resolve(new Response(stream)),
  });
  await expect(embedder.embed(request())).rejects.toMatchObject({
    code: 'EMBEDDING_PROVIDER_FAILED',
    cause,
  });
  expect(stream.locked).toBe(false);
});

it('decodes split UTF-8 and releases the reader on successful completion without extra normalization', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...wireResponse(), extra: '🐈' }));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  const embedder = createHttpTextEmbedder({
    config: httpConfig('https://example.test/embed'),
    fetch: () => Promise.resolve(new Response(stream)),
  });
  expect((await embedder.embed(request())).embeddings[0]?.vector).toEqual([1, 0]);
  expect(stream.locked).toBe(false);
});

it.each(['buffer', 'overridden-slice'])(
  'owns %s chunks before a later read reuses their storage',
  async (kind) => {
    const bytes = Buffer.from(JSON.stringify(wireResponse()));
    const digit = bytes.indexOf('[1,0]') + 1;
    expect(digit).toBeGreaterThan(0);
    const slice = vi.fn(() => bytes);
    if (kind === 'overridden-slice') {
      Object.defineProperty(bytes, 'slice', { value: slice });
    }
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (reads++ === 0) {
            controller.enqueue(bytes);
          } else {
            // A borrowed transport reuses the previous storage on its next read.
            bytes[digit] = '9'.charCodeAt(0);
            controller.close();
          }
        },
      },
      { highWaterMark: 0 }
    );
    const embedder = createHttpTextEmbedder({
      config: httpConfig('https://example.test/embed'),
      fetch: () => Promise.resolve(new Response(stream)),
    });
    expect((await embedder.embed(request())).embeddings[0]?.vector).toEqual([1, 0]);
    expect(bytes[digit]).toBe('9'.charCodeAt(0));
    expect(slice).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
  }
);
