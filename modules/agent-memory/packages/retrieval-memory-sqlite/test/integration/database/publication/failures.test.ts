import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { fixture } from '../../../support/fixture.js';
it.each(['rm_entries', 'rm_chunks', 'rm_receipts'])(
  'rolls back Entry, vector, view and receipt when %s insertion fails',
  async (table) => {
    const f = await fixture();
    await f.create();
    const db = new DatabaseSync(f.path);
    try {
      db.exec(
        `CREATE TRIGGER fail_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected failure'); END;`
      );
      await expect(
        f.mutations.run('ingest', { memoryId: 'space', requestId: 'failed', content: 'aligned' })
      ).rejects.toMatchObject({ code: 'STORAGE_FAILED', commit: { status: 'not-committed' } });
      expect((await f.backend.inspect('space'))?.sequence).toBe(0);
      expect((await f.search()).hits).toEqual([]);
      expect(await f.backend.getReceipt('space', 'failed')).toBeUndefined();
      db.exec('DROP TRIGGER fail_write');
      expect(
        (
          await f.mutations.run('ingest', {
            memoryId: 'space',
            requestId: 'failed',
            content: 'aligned',
          })
        ).receipt.sequence
      ).toBe(1);
    } finally {
      db.close();
    }
  }
);
it('observes timer cancellation after a native lock wait without blocking the host loop', async () => {
  const f = await fixture();
  await f.create();
  const signal = new AbortController();
  const prepared = await f.mutations.prepare(
    'ingest',
    { memoryId: 'space', requestId: 'blocked', content: 'aligned' },
    signal.signal
  );
  const lock = new DatabaseSync(f.path);
  lock.exec('BEGIN IMMEDIATE');
  let timerRan = false;
  const timer = setTimeout(() => {
    timerRan = true;
    signal.abort();
    lock.exec('ROLLBACK');
  }, 30);
  try {
    await expect(f.mutations.publish(prepared, signal.signal)).rejects.toMatchObject({
      code: 'OPERATION_ABORTED',
      commit: { status: 'not-committed' },
    });
    expect(timerRan).toBe(true);
    expect((await f.backend.inspect('space'))?.sequence).toBe(0);
  } finally {
    clearTimeout(timer);
    if (lock.isTransaction) lock.exec('ROLLBACK');
    lock.close();
  }
});
it('recovers a committed lost reply through the durable request without duplicate publication', async () => {
  const f = await fixture();
  await f.create();
  const publish = f.backend.publish.bind(f.backend);
  let drop = true;
  f.backend.publish = async (...args) => {
    const receipt = await publish(...args);
    if (drop) {
      drop = false;
      throw new Error('lost reply');
    }
    return receipt;
  };
  const input = { memoryId: 'space', requestId: 'lost', content: 'aligned' };
  await expect(f.mutations.run('ingest', input)).rejects.toMatchObject({
    code: 'COMMIT_UNKNOWN',
    commit: { status: 'unknown' },
  });
  expect((await f.mutations.run('ingest', input)).receipt.sequence).toBe(1);
  expect((await f.search()).hits).toHaveLength(1);
});
