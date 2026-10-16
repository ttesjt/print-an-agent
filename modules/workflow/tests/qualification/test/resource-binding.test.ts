import { expect, it, vi } from 'vitest';
import { recordUpdate, type UpdatePorts } from './consumers/record-update.js';
import { gate, onAbort } from './support/execution.js';
import { SqliteRecords } from './support/sqlite-records.js';

it('reuses a bound SQLite store after one concurrent run is cancelled without closing the shared store', async () => {
  const records = new SqliteRecords(':memory:');
  const caller = new AbortController();
  const started = gate();
  const release = gate();
  const close = vi.spyOn(records, 'close');
  let reads = 0;
  const resources: UpdatePorts = {
    records: {
      read: async (id, signal) => {
        const record = await records.read(id, signal);
        if (++reads === 2) started.resolve();
        if (id === 'cancelled') {
          await onAbort(signal);
        } else {
          await release.promise;
        }
        signal.throwIfAborted();
        return record;
      },
      compareAndSwap: (id, revision, title, signal) =>
        records.compareAndSwap(id, revision, title, signal),
    },
    titleLimit: () => Promise.resolve(80),
  };
  records.seed('cancelled', 'original');
  records.seed('survivor', 'original');
  const flow = recordUpdate(resources);
  const cancelled = flow
    .run({
      input: { id: 'cancelled', enabled: true, title: 'must not commit' },
      signal: caller.signal,
    })
    .catch((error: unknown) => error);
  const survivor = flow.run({ input: { id: 'survivor', enabled: true, title: 'committed' } });
  try {
    await started.promise;
    caller.abort();
    expect(await cancelled).toBe(caller.signal.reason);
    release.resolve();
    await expect(survivor).resolves.toEqual({
      status: 'updated',
      record: { revision: 2, title: 'committed' },
    });
    const signal = new AbortController().signal;
    await expect(records.read('cancelled', signal)).resolves.toEqual({
      revision: 1,
      title: 'original',
    });
    await expect(
      flow.run({ input: { id: 'survivor', enabled: true, title: 'reused' } })
    ).resolves.toEqual({ status: 'updated', record: { revision: 3, title: 'reused' } });
    expect(close).not.toHaveBeenCalled();
  } finally {
    caller.abort();
    release.resolve();
    await Promise.allSettled([cancelled, survivor]);
    records.close();
  }
  expect(close).toHaveBeenCalledTimes(1);
});
