import { expect, it } from 'vitest';
import { ContextMemoryError } from '@print-an-agent/context-memory';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';
import { consumer } from './support/model.js';
import { memoryPath, ownedStore, borrowDatabase } from './support/storage.js';
import { FaultDatabase } from './support/fault-database.js';

it.each([false, true])(
  'recovers commit facts after lost delivery (disconnected: %s) without replanning',
  async (disconnect) => {
    const path = await memoryPath();
    const database = new FaultDatabase(path);
    borrowDatabase(database);
    const store = new SqliteMemoryStore({ database });
    const client = consumer(store, () => [{ op: 'add', content: 'durable' }]);
    await client.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
    const controller = new AbortController();
    database.afterCommit = () => controller.abort();
    database.disconnectAfterCommit = disconnect;
    database.loseCommitReply = true;
    const input = { memoryId: 'a', requestId: 'edit', instruction: 'remember' };
    const failure: unknown = await client.bundle.workflows.edit
      .run({ input, signal: controller.signal })
      .catch((cause: unknown) => cause);
    expect(failure).toMatchObject({
      code: disconnect ? 'COMMIT_STATUS_UNKNOWN' : 'STORAGE_FAILED',
      commit: { status: disconnect ? 'unknown' : 'committed' },
    });
    expect(controller.signal.aborted).toBe(true);
    expect(client.actor.requests).toHaveLength(1);
    store.close();
    const reopened = consumer(ownedStore(path), () => {
      throw new Error('Recovery must not invoke the model.');
    });
    const receipt = await reopened.bundle.workflows.getReceipt.run({
      input: { memoryId: 'a', requestId: 'edit' },
    });
    expect(receipt).toMatchObject({ revision: 2 });
    expect(await reopened.bundle.workflows.edit.run({ input })).toEqual({
      status: 'committed',
      receipt,
    });
    const context = await reopened.bundle.workflows.readContext.run({ input: { memoryId: 'a' } });
    expect(context?.snapshot.items.map((item) => item.id)).toEqual(receipt?.changes.addedItemIds);
    expect(context?.text).toBe('durable');
    expect(reopened.actor.requests).toHaveLength(0);
  }
);

it('reports rollback cleanup failure through the Workflow and keeps host-owned cleanup explicit', async () => {
  const database = new FaultDatabase(':memory:');
  borrowDatabase(database);
  const store = new SqliteMemoryStore({ database });
  const client = consumer(store, () => [{ op: 'add', content: 'candidate' }]);
  await client.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  database.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON context_memory_receipts
    BEGIN SELECT RAISE(ABORT, 'receipt failure'); END`);
  database.failRollback = true;
  const failure: unknown = await client.bundle.workflows.edit
    .run({
      input: { memoryId: 'a', requestId: 'edit', instruction: 'change' },
    })
    .catch((cause: unknown) => cause);
  expect(failure).toMatchObject({ code: 'CLEANUP_FAILED', commit: { status: 'unknown' } });
  if (!(failure instanceof ContextMemoryError) || !(failure.cause instanceof AggregateError))
    throw new Error('Both transaction and cleanup errors must survive.');
  expect(failure.cause.errors).toHaveLength(2);
  expect(() => store.close()).toThrow(failure);
  expect(database.isOpen).toBe(true);
  expect(database.isTransaction).toBe(true);
  database.failRollback = false;
  database.exec('ROLLBACK');
  expect(database.prepare('SELECT revision FROM context_memory_documents').get()?.revision).toBe(1);
  expect(
    database.prepare('SELECT COUNT(*) AS count FROM context_memory_receipts').get()?.count
  ).toBe(1);
});

it('rolls back a cancelled pre-commit mutation atomically and accepts the same request later', async () => {
  const database = borrowDatabase();
  const store = new SqliteMemoryStore({ database });
  const client = consumer(store, () => [{ op: 'add', content: 'candidate' }]);
  await client.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const controller = new AbortController();
  database.function('abort_memory', () => {
    controller.abort();
    return 0;
  });
  database.exec(`CREATE TRIGGER abort_write AFTER INSERT ON context_memory_receipts
    BEGIN SELECT abort_memory(); END`);
  const input = { memoryId: 'a', requestId: 'edit', instruction: 'change' };
  await expect(
    client.bundle.workflows.edit.run({ input, signal: controller.signal })
  ).rejects.toMatchObject({
    code: 'OPERATION_ABORTED',
    commit: { status: 'not-committed' },
  });
  expect(await store.getReceipt('a', 'edit')).toBeUndefined();
  expect((await store.read('a'))?.revision).toBe(1);
  expect(database.isTransaction).toBe(false);
  database.exec('DROP TRIGGER abort_write');
  expect(await client.bundle.workflows.edit.run({ input })).toMatchObject({
    status: 'committed',
    receipt: { revision: 2 },
  });
  expect(client.actor.requests).toHaveLength(2);
});
