import { expect, it } from 'vitest';
import { fixture } from './support/fixture.js';
it('normalizes extreme document vectors and queries before cosine ranking', async () => {
  const f = await fixture();
  await f.create();
  await f.mutations.run('ingest', { memoryId: 'space', requestId: 'a', content: 'aligned' });
  await f.mutations.run('ingest', { memoryId: 'space', requestId: 'b', content: 'angled' });
  const hits = (await f.search()).hits;
  expect(hits.map((hit) => hit.text)).toEqual(['aligned', 'angled']);
  expect(hits[0]?.ranking.value).toBeCloseTo(0);
  expect(hits[1]?.ranking.value).toBeCloseTo(0.2);
  await expect(
    f.backend.search({
      space: (await f.backend.inspect('space'))!,
      vector: [1e20, 0, 0, 0],
      topK: 1,
    })
  ).rejects.toMatchObject({ code: 'REPRESENTATION_INVALID' });
});
it('constrains metadata before topK rather than filtering globally nearest rows afterwards', async () => {
  const f = await fixture();
  await f.create();
  await f.create('other');
  await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'a',
    content: 'aligned forbidden',
    metadata: { allowed: false },
  });
  await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'b',
    content: 'angled eligible',
    metadata: { allowed: true, explicit: null, nested: { 'a.b': 'yes' }, array: ['no'] },
  });
  await f.mutations.run('ingest', {
    memoryId: 'other',
    requestId: 'c',
    content: 'aligned other',
    metadata: { allowed: true },
  });
  expect(
    (
      await f.search('space', { topK: 1, filter: { op: 'eq', path: ['allowed'], value: true } })
    ).hits.map((hit) => hit.text)
  ).toEqual(['angled eligible']);
  for (const filter of [
    { op: 'eq', path: ['allowed'], value: 1 },
    { op: 'eq', path: ['missing'], value: null },
    { op: 'eq', path: ['array', '0'], value: 'no' },
  ] as const)
    expect((await f.search('space', { filter })).hits).toHaveLength(0);
  expect(
    (
      await f.search('space', {
        filter: {
          op: 'and',
          filters: [
            { op: 'exists', path: ['explicit'], value: true },
            { op: 'in', path: ['nested', 'a.b'], values: ['yes'] },
          ],
        },
      })
    ).hits
  ).toHaveLength(1);
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
