import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { fixture } from '../../../support/fixture.js';

it('binds cursor scope to the requested identity even if a stored payload names another Space', async () => {
  const f = await fixture();
  await f.create();
  await f.mutations.run('ingest', { memoryId: 'space', requestId: 'a', content: 'aligned' });
  const page = await f.backend.list({ memoryId: 'space', limit: 1 });
  const after = page.entries[0]?.entryId;
  if (after === undefined) throw new Error('Missing test Entry');
  const cursor = Buffer.from(
    JSON.stringify({
      memoryId: 'other',
      sequence: page.space.sequence,
      order: 'entry-id-utf8-v1',
      after,
    })
  ).toString('base64url');
  const db = new DatabaseSync(f.path);
  try {
    db.exec("UPDATE rm_spaces SET payload=json_set(payload,'$.memoryId','other')");
    await expect(f.backend.list({ memoryId: 'space', limit: 1, cursor })).rejects.toMatchObject({
      code: 'STALE_CURSOR',
    });
  } finally {
    db.close();
  }
});

it('distinguishes malformed cursors from stale scopes and validates native list limits', async () => {
  const f = await fixture();
  await f.create();
  await expect(
    f.backend.list({ memoryId: 'space', limit: 1, cursor: Buffer.from('{').toString('base64url') })
  ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  await expect(
    f.backend.list({ memoryId: 'space', limit: 1, cursor: Buffer.from('{}').toString('base64url') })
  ).rejects.toMatchObject({ code: 'STALE_CURSOR' });
  for (const limit of [0, 0.5, 1001])
    await expect(f.backend.list({ memoryId: 'space', limit })).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
    });
});
it('paginates scoped UTF-8 Entry IDs and detects same-Space changes', async () => {
  const f = await fixture();
  const memoryId = 'long-space-' + 'a'.repeat(400);
  await f.create(memoryId);
  await f.create('other');
  for (let i = 0; i < 4; i++)
    await f.mutations.run('ingest', { memoryId, requestId: `r-${i}`, content: String(i) });
  const first = await f.backend.list({ memoryId, limit: 2 });
  expect(first.nextCursor).not.toBeNull();
  await f.mutations.run('ingest', { memoryId: 'other', requestId: 'other', content: 'unrelated' });
  const second = await f.backend.list({ memoryId, limit: 2, cursor: first.nextCursor! });
  expect(new Set([...first.entries, ...second.entries].map((entry) => entry.entryId)).size).toBe(4);
  expect(second.nextCursor).toBeNull();
  await expect(
    f.backend.list({ memoryId: 'other', limit: 2, cursor: first.nextCursor! })
  ).rejects.toMatchObject({ code: 'STALE_CURSOR' });
  await f.mutations.run('ingest', { memoryId, requestId: 'new', content: 'new' });
  await expect(
    f.backend.list({ memoryId, limit: 2, cursor: first.nextCursor! })
  ).rejects.toMatchObject({ code: 'STALE_CURSOR' });
});
