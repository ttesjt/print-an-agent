import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';
import { borrowed, domain, fileStores } from './support/fixtures.js';

it('reconstructs every version across multiple baselines and does not record no-op versions', async () => {
  const { store, mutations, database } = borrowed();
  await mutations.create({
    memoryId: 'm',
    requestId: 'create',
    items: [{ content: 'hello'.repeat(300) }],
    config: { maxContextTokens: null },
  });
  const expected = [(await store.read('m'))!];
  for (let revision = 2; revision <= 75; revision++) {
    await mutations.apply({
      memoryId: 'm',
      requestId: String(revision),
      expectedRevision: revision - 1,
      commands: [
        {
          op: 'replace',
          itemId: expected[0]!.items[0]!.id,
          content: 'hello'.repeat(300) + String(revision),
        },
      ],
    });
    expected.push((await store.read('m'))!);
  }
  for (const snapshot of expected)
    expect(
      await store.readVersion({ memoryId: snapshot.memoryId, revision: snapshot.revision })
    ).toEqual(snapshot);
  await mutations.apply({ memoryId: 'm', requestId: 'noop', expectedRevision: 75, commands: [] });
  expect(database.prepare('SELECT count(*) AS n FROM context_memory_history').get()?.n).toBe(75);
  expect(
    database.prepare("SELECT count(*) AS n FROM context_memory_history WHERE kind = 'base'").get()
      ?.n
  ).toBe(3);
  expect(await store.readVersion({ memoryId: 'm', revision: 76 })).toBeUndefined();
});

it('paginates a frozen upper bound and rejects a cursor reused with another scope or limit', async () => {
  const { store, mutations } = borrowed();
  for (const memoryId of ['m', 'other']) {
    await mutations.create({ memoryId, requestId: 'create' });
    for (let revision = 2; revision <= 5; revision++)
      await mutations.apply({
        memoryId,
        requestId: String(revision),
        expectedRevision: revision - 1,
        commands: [{ op: 'add', content: String(revision) }],
      });
  }
  const first = await store.listVersions({ memoryId: 'm', limit: 2 });
  expect(first.versions.map((v) => v.revision)).toEqual([5, 4]);
  await mutations.apply({
    memoryId: 'm',
    requestId: 'later',
    expectedRevision: 5,
    commands: [{ op: 'add', content: 'later' }],
  });
  const second = await store.listVersions({ memoryId: 'm', limit: 2, cursor: first.nextCursor! });
  expect(second.throughRevision).toBe(5);
  expect(second.versions.map((v) => v.revision)).toEqual([3, 2]);
  const third = await store.listVersions({ memoryId: 'm', limit: 2, cursor: second.nextCursor! });
  expect(third.versions.map((v) => v.revision)).toEqual([1]);
  expect(third.nextCursor).toBeUndefined();
  for (const input of [
    { memoryId: 'other', limit: 2, cursor: first.nextCursor! },
    { memoryId: 'm', limit: 3, cursor: first.nextCursor! },
    { memoryId: 'm', limit: 2, cursor: 'broken' },
  ])
    await expect(store.listVersions(input)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
});

it.each(['context_memory_history', 'context_memory_documents', 'context_memory_receipts'])(
  'rolls back history, head and receipt if %s publication fails',
  async (table) => {
    const { store, mutations, database } = borrowed();
    await mutations.create({ memoryId: 'm', requestId: 'c' });
    database.exec(
      `CREATE TRIGGER fail_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected'); END`
    );
    await expect(
      mutations.apply({
        memoryId: 'm',
        requestId: 'write',
        expectedRevision: 1,
        commands: [{ op: 'add', content: 'x' }],
      })
    ).rejects.toMatchObject({ commit: { status: 'not-committed' } });
    expect((await store.read('m'))?.revision).toBe(1);
    expect(await store.readVersion({ memoryId: 'm', revision: 2 })).toBeUndefined();
    expect(await store.getReceipt('m', 'write')).toBeUndefined();
    expect(database.isTransaction).toBe(false);
  }
);

it('arbitrates across connections without extra history and reopens exact committed versions', async () => {
  const { first, second, path, register } = await fileStores();
  const a = domain(first).mutations;
  const b = domain(second).mutations;
  await a.create({ memoryId: 'm', requestId: 'c' });
  const input = {
    memoryId: 'm',
    requestId: 'same',
    expectedRevision: 1,
    commands: [{ op: 'add' as const, content: 'one' }],
  };
  expect(await a.apply(input)).toEqual(await b.apply(input));
  const race = await Promise.allSettled([
    a.apply({ ...input, requestId: 'a', expectedRevision: 2 }),
    b.apply({ ...input, requestId: 'b', expectedRevision: 2 }),
  ]);
  expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await first.listVersions({ memoryId: 'm' })).versions).toHaveLength(3);
  const reopened = new SqliteMemoryStore({ path });
  register(reopened);
  expect(await reopened.readVersion({ memoryId: 'm', revision: 2 })).toEqual(
    await second.readVersion({ memoryId: 'm', revision: 2 })
  );
});

it('migrates only the legacy current revision and preserves old receipts', async () => {
  const source = borrowed();
  await source.mutations.create({ memoryId: 'm', requestId: 'c' });
  const snapshot = { ...(await source.store.read('m'))!, revision: 7 };
  const receipt = (await source.store.getReceipt('m', 'c'))!;
  const database = new DatabaseSync(':memory:');
  database.exec(
    'CREATE TABLE context_memory_documents (memory_id TEXT PRIMARY KEY, revision INTEGER, snapshot_json TEXT); CREATE TABLE context_memory_receipts (memory_id TEXT, request_id TEXT, receipt_json TEXT, PRIMARY KEY(memory_id,request_id))'
  );
  database
    .prepare('INSERT INTO context_memory_documents VALUES (?, ?, ?)')
    .run('m', 7, JSON.stringify(snapshot));
  database
    .prepare('INSERT INTO context_memory_receipts VALUES (?, ?, ?)')
    .run('m', 'c', JSON.stringify(receipt));
  const { store } = borrowed(database);
  expect(await store.readVersion({ memoryId: 'm', revision: 7 })).toEqual(snapshot);
  expect(await store.readVersion({ memoryId: 'm', revision: 6 })).toBeUndefined();
  expect(await store.getReceipt('m', 'c')).toEqual(receipt);
  expect((await store.listVersions({ memoryId: 'm' })).versions).toEqual([
    { memoryId: 'm', revision: 7 },
  ]);
});

it('rejects corrupted payloads and unknown formats without using head as a fallback', async () => {
  const { store, mutations, database } = borrowed();
  await mutations.create({
    memoryId: 'm',
    requestId: 'c',
    items: [{ content: 'hello'.repeat(300) }],
  });
  await mutations.apply({
    memoryId: 'm',
    requestId: 'a',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'next' }],
  });
  database
    .prepare('UPDATE context_memory_history SET payload_json = ? WHERE revision = 1')
    .run('{}');
  await expect(store.readVersion({ memoryId: 'm', revision: 1 })).rejects.toMatchObject({
    code: 'HISTORY_CORRUPT',
  });
  expect((await store.read('m'))?.revision).toBe(2);
  database.prepare('UPDATE context_memory_history SET format = 9 WHERE revision = 2').run();
  await expect(store.readVersion({ memoryId: 'm', revision: 2 })).rejects.toMatchObject({
    code: 'HISTORY_CORRUPT',
  });
});
