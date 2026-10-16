import { expect, it, vi } from 'vitest';
import { recordBundle } from './consumers/record-bundle.js';
import type { UpdatePorts } from './consumers/record-update.js';
import { gate, onAbort } from './support/execution.js';
import { SqliteRecords } from './support/sqlite-records.js';

it('cancels an update independently of a concurrent sibling inspection and reuses both members afterward', async () => {
  const records = new SqliteRecords(':memory:');
  const close = vi.spyOn(records, 'close');
  const caller = new AbortController();
  const bothStarted = gate();
  const release = gate();
  let reads = 0;
  let siblingSignal: AbortSignal | undefined;
  const compareAndSwap = vi.fn(records.compareAndSwap.bind(records));
  const resources: UpdatePorts = {
    records: {
      read: async (id, signal) => {
        const record = await records.read(id, signal);
        if (++reads === 2) bothStarted.resolve();
        if (id === 'cancelled') {
          await onAbort(signal);
        } else {
          siblingSignal = signal;
          await release.promise;
        }
        signal.throwIfAborted();
        return record;
      },
      compareAndSwap,
    },
    titleLimit: () => Promise.resolve(80),
  };
  records.seed('cancelled', 'original');
  records.seed('survivor', 'original');
  const bundle = recordBundle(resources);
  const cancelled = bundle.workflows.update
    .run({
      input: { enabled: true, id: 'cancelled', title: 'must not commit' },
      signal: caller.signal,
    })
    .catch((error: unknown) => error);
  const inspected = bundle.workflows.inspect.run({ input: { id: 'survivor' } });
  const observed = inspected.catch(() => undefined);
  try {
    await bothStarted.promise;
    caller.abort();
    expect(await cancelled).toBe(caller.signal.reason);
    expect(siblingSignal?.aborted).toBe(false);
    expect(compareAndSwap).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    release.resolve();
    await expect(inspected).resolves.toEqual({ revision: 1, title: 'original' });
    await expect(
      bundle.workflows.update.run({ input: { enabled: true, id: 'survivor', title: 'reused' } })
    ).resolves.toMatchObject({ status: 'updated', record: { revision: 2 } });
    await expect(bundle.workflows.inspect.run({ input: { id: 'survivor' } })).resolves.toEqual({
      revision: 2,
      title: 'reused',
    });
    await expect(records.read('cancelled', new AbortController().signal)).resolves.toEqual({
      revision: 1,
      title: 'original',
    });
    expect(compareAndSwap).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  } finally {
    caller.abort();
    release.resolve();
    await Promise.allSettled([cancelled, observed]);
    records.close();
  }
  expect(close).toHaveBeenCalledTimes(1);
});
