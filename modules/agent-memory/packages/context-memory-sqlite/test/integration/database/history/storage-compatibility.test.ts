import { expect, it } from 'vitest';

import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';

import fixture from '../../../fixtures/history-v1.json';

import { borrowed, domain } from '../../../support/fixtures.js';

it('preserves version-one record, receipt and cursor encodings', async () => {
  const { database, store } = borrowed();
  const { mutations } = domain(store, undefined, () => 'fixed-item');
  await mutations.create({
    memoryId: 'compat',
    requestId: 'create',
    items: [{ content: 'alpha '.repeat(120) }],
    config: { maxContextTokens: null },
  });
  for (let revision = 2; revision <= 3; revision++)
    await mutations.apply({
      memoryId: 'compat',
      requestId: 'edit-' + revision,
      expectedRevision: revision - 1,
      commands: [
        { op: 'replace', itemId: 'fixed-item', content: 'alpha '.repeat(120) + '😀\0' + revision },
      ],
    });
  expect(database.prepare('SELECT * FROM context_memory_history ORDER BY revision').all()).toEqual(
    fixture.history
  );
  expect(
    database.prepare('SELECT * FROM context_memory_receipts ORDER BY request_id').all()
  ).toEqual(fixture.receipts);
  expect(database.prepare('SELECT * FROM context_memory_documents').get()).toEqual(fixture.head);
  expect((await store.listVersions({ memoryId: 'compat', limit: 1 })).nextCursor).toBe(
    fixture.cursor
  );
});

it('reads pre-refactor history and cursors after changing the policy for new writes', async () => {
  const { database } = borrowed();
  database
    .prepare('INSERT INTO context_memory_documents VALUES (?, ?, ?)')
    .run(fixture.head.memory_id, fixture.head.revision, fixture.head.snapshot_json);
  for (const row of fixture.receipts)
    database
      .prepare('INSERT INTO context_memory_receipts VALUES (?, ?, ?)')
      .run(row.memory_id, row.request_id, row.receipt_json);
  for (const row of fixture.history)
    database
      .prepare('INSERT INTO context_memory_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        row.memory_id,
        row.revision,
        row.format,
        row.kind,
        row.previous_revision,
        row.depth,
        row.digest,
        row.payload_json
      );
  const store = new SqliteMemoryStore({ database, history: { maxDeltaChain: 1 } });
  try {
    for (const snapshot of fixture.snapshots)
      expect(
        await store.readVersion({ memoryId: snapshot.memoryId, revision: snapshot.revision })
      ).toEqual(snapshot);
    await domain(store).mutations.apply({
      memoryId: 'compat',
      requestId: 'later',
      expectedRevision: 3,
      commands: [{ op: 'add', content: 'later' }],
    });
    expect(
      database.prepare('SELECT kind FROM context_memory_history WHERE revision = 4').get()?.kind
    ).toBe('base');
    expect(
      await store.listVersions({ memoryId: 'compat', limit: 1, cursor: fixture.cursor })
    ).toMatchObject({ throughRevision: 3, versions: [{ memoryId: 'compat', revision: 2 }] });
    expect(await store.readVersion({ memoryId: 'compat', revision: 3 })).toEqual(
      fixture.snapshots[2]
    );
    expect(await store.getReceipt('compat', 'create')).toBeDefined();
  } finally {
    store.close();
  }
});
