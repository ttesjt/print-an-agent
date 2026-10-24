import { DatabaseSync } from 'node:sqlite';
import { load } from 'sqlite-vec';
import { expect, it } from 'vitest';
import { fixture } from './support/fixture.js';
it('keeps authority and binary representations readable when the derived index is lost and rebuilds it', async () => {
  const f = await fixture();
  await f.create();
  const { receipt } = await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'a',
    content: 'aligned',
    source: { ref: 'original' },
  });
  const before = await f.backend.get('space', receipt.entryId!);
  const db = new DatabaseSync(f.path, { allowExtension: true });
  load(db);
  db.enableLoadExtension(false);
  try {
    db.exec('DROP TABLE rm_vectors_4');
  } finally {
    db.close();
  }
  expect((await f.backend.get('space', receipt.entryId!))?.entry).toEqual(before?.entry);
  await f.mutations.run('reindex', {
    memoryId: 'space',
    requestId: 'repair',
    entryId: receipt.entryId!,
    expectedRevision: 1,
  });
  expect((await f.search()).hits[0]).toMatchObject({
    text: 'aligned',
    entryRevision: 1,
    source: { ref: 'original' },
  });
});
