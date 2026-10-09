import { describe, expect, it, vi } from 'vitest';
import { createResultStream } from '../../src/output-invocation/result-stream.js';

describe('local invocation result stream ownership', () => {
  it.each(['before-next', 'partial', 'exhausted', 'failure'] as const)(
    'cleans up on %s',
    async (ending) => {
      const failure = new Error('reader failed');
      let count = 0;
      const next = vi.fn((): Promise<IteratorResult<string>> => {
        if (ending === 'failure') return Promise.reject(failure);
        if (count++ > 0) return Promise.resolve({ done: true, value: undefined });
        return Promise.resolve({
          done: false,
          value: JSON.stringify({ kind: 'chunk', result: 'one' }),
        });
      });
      const returned = vi.fn(() => Promise.resolve({ done: true as const, value: undefined }));
      const stop = vi.fn(() => Promise.resolve());
      const requireSuccess = vi.fn(() => Promise.resolve());
      const iterator = createResultStream({ next, return: returned }, { stop, requireSuccess })[
        Symbol.asyncIterator
      ]();
      if (ending === 'failure')
        await expect(iterator.next()).rejects.toMatchObject({ cause: failure });
      else if (ending !== 'before-next')
        await expect(iterator.next()).resolves.toEqual({ done: false, value: 'one' });
      if (ending === 'exhausted')
        await expect(iterator.next()).resolves.toMatchObject({ done: true });
      await Promise.all([iterator.return?.(), iterator.return?.()]);
      expect(stop).toHaveBeenCalledTimes(ending === 'exhausted' ? 0 : 1);
      expect(returned).toHaveBeenCalledTimes(ending === 'exhausted' ? 0 : 1);
      expect(requireSuccess).toHaveBeenCalledTimes(ending === 'exhausted' ? 1 : 0);
      const expectedPulls = ending === 'before-next' ? 0 : ending === 'exhausted' ? 2 : 1;
      expect(next).toHaveBeenCalledTimes(expectedPulls);
      await expect(iterator.next()).resolves.toMatchObject({ done: true });
      expect(next).toHaveBeenCalledTimes(expectedPulls);
    }
  );

  it('stops the producer before awaiting return queued behind a pending read', async () => {
    const pendingRead = Promise.withResolvers<IteratorResult<string>>();
    const order: string[] = [];
    const next = vi.fn(() => pendingRead.promise);
    const returned = vi.fn(async () => {
      await pendingRead.promise;
      order.push('reader-return');
      return { done: true as const, value: undefined };
    });
    const stop = vi.fn(() => {
      order.push('stop');
      pendingRead.resolve({ done: true, value: undefined });
      return Promise.resolve();
    });
    const iterator = createResultStream(
      { next, return: returned },
      {
        stop,
        requireSuccess: () => Promise.resolve(),
      }
    )[Symbol.asyncIterator]();
    const read = iterator.next();
    await iterator.return?.();
    await expect(read).resolves.toMatchObject({ done: true });
    expect(order).toEqual(['stop', 'reader-return']);
    expect(stop).toHaveBeenCalledOnce();
    expect(returned).toHaveBeenCalledOnce();
  });

  it('attempts both cleanups and preserves their failures without repeated release', async () => {
    const stopFailure = new Error('stop failed');
    const readerFailure = new Error('reader close failed');
    const stop = vi.fn(() => Promise.reject(stopFailure));
    const returned = vi.fn(() => Promise.reject(readerFailure));
    const next = vi.fn();
    const iterator = createResultStream(
      { next, return: returned },
      {
        stop,
        requireSuccess: () => Promise.resolve(),
      }
    )[Symbol.asyncIterator]();
    const failure = await iterator.return?.().catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw new Error('Expected both cleanup failures.');
    expect(failure.errors).toEqual([stopFailure, readerFailure]);
    await expect(iterator.return?.()).rejects.toBe(failure);
    expect(stop).toHaveBeenCalledOnce();
    expect(returned).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
});
