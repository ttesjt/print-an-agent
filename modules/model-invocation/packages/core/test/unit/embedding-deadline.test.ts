import { afterEach, expect, it, vi } from 'vitest';
import { createTextEmbedder } from '../../src/index.js';
import { embeddingDefinition, embeddingRequest } from '../support/embedding.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function controlledClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return (value: number): void => {
    now = value;
  };
}

it.each([5, 40])(
  'rejects success at monotonic time %s before the timeout callback can run',
  async (elapsed) => {
    const setNow = controlledClock();
    const parent = new AbortController();
    let executionSignal: AbortSignal | undefined;
    const capability = createTextEmbedder({
      ...embeddingDefinition(),
      invocationPolicy: { timeoutMilliseconds: 5 },
      embed: ({ signal }) => {
        executionSignal = signal;
        setNow(elapsed);
        // Do not advance fake timers: model synchronous work finishing before timer dispatch.
        return Promise.resolve([{ id: 'first', vector: [1, 0] }]);
      },
    });
    await expect(capability.embed(embeddingRequest(parent.signal))).rejects.toMatchObject({
      code: 'EMBEDDING_INVOCATION_TIMEOUT',
    });
    expect(executionSignal?.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  }
);

it('covers synchronous result normalization before accepting a terminal result', async () => {
  const setNow = controlledClock();
  const vector = new Proxy([1, 0], {
    getOwnPropertyDescriptor(target, field) {
      if (field === '1') setNow(40);
      return Reflect.getOwnPropertyDescriptor(target, field);
    },
  });
  const capability = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: 5 },
    embed: () => Promise.resolve([{ id: 'first', vector }]),
  });
  await expect(capability.embed(embeddingRequest())).rejects.toMatchObject({
    code: 'EMBEDDING_INVOCATION_TIMEOUT',
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps an observed parent cancellation authoritative when the local timer is starved', async () => {
  const setNow = controlledClock();
  const parent = new AbortController();
  const reason = new DOMException('parent deadline', 'TimeoutError');
  const capability = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: 5 },
    embed: () => {
      setNow(40);
      parent.abort(reason);
      return Promise.resolve([{ id: 'first', vector: [1, 0] }]);
    },
  });
  await expect(capability.embed(embeddingRequest(parent.signal))).rejects.toMatchObject({
    code: 'EMBEDDING_INVOCATION_CANCELLED',
    cause: reason,
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps an already fired local deadline authoritative over later parent cancellation', async () => {
  const setNow = controlledClock();
  const parent = new AbortController();
  const settled = Promise.withResolvers<readonly { id: string; vector: readonly number[] }[]>();
  const capability = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: 5 },
    embed: () => settled.promise,
  });
  const result = capability.embed(embeddingRequest(parent.signal));
  const checked = expect(result).rejects.toMatchObject({ code: 'EMBEDDING_INVOCATION_TIMEOUT' });
  setNow(5);
  await vi.advanceTimersByTimeAsync(5);
  parent.abort(new Error('later parent cancellation'));
  settled.resolve([{ id: 'first', vector: [1, 0] }]);
  await checked;
  expect(vi.getTimerCount()).toBe(0);
});

it('accepts results before the monotonic deadline despite a wall-clock adjustment', async () => {
  const setNow = controlledClock();
  const capability = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: 5 },
    embed: () => {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      setNow(4);
      return Promise.resolve([{ id: 'first', vector: [1, 0] }]);
    },
  });
  await expect(capability.embed(embeddingRequest())).resolves.toHaveProperty('embeddings');
  expect(vi.getTimerCount()).toBe(0);
});

it('does not add a deadline when the policy is null', async () => {
  const setNow = controlledClock();
  const capability = createTextEmbedder({
    ...embeddingDefinition(),
    invocationPolicy: { timeoutMilliseconds: null },
    embed: () => {
      setNow(1_000_000);
      return Promise.resolve([{ id: 'first', vector: [1, 0] }]);
    },
  });
  await expect(capability.embed(embeddingRequest())).resolves.toHaveProperty('embeddings');
  expect(vi.getTimerCount()).toBe(0);
});

it.each([4, 40])(
  'settles a backend failure at monotonic time %s under the same deadline rules',
  async (elapsed) => {
    const setNow = controlledClock();
    const cause = new Error('backend failure');
    const capability = createTextEmbedder({
      ...embeddingDefinition(),
      invocationPolicy: { timeoutMilliseconds: 5 },
      embed: () => {
        setNow(elapsed);
        throw cause;
      },
    });
    await expect(capability.embed(embeddingRequest())).rejects.toMatchObject(
      elapsed < 5
        ? { code: 'EMBEDDING_PROVIDER_FAILED', cause }
        : { code: 'EMBEDDING_INVOCATION_TIMEOUT' }
    );
    expect(vi.getTimerCount()).toBe(0);
  }
);
