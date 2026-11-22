import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { fixture } from '../../../support/fixture.js';

it('accepts sequence changes with the same representation configuration and enforces native topK', async () => {
  const f = await fixture();
  await f.create();
  const space = await f.backend.inspect('space');
  if (space === undefined) throw new Error('Missing test Space');
  await f.mutations.run('ingest', { memoryId: 'space', requestId: 'a', content: 'aligned' });
  const result = await f.backend.search({ space, vector: [1, 0, 0, 0], topK: 1 });
  expect(result.space.sequence).toBeGreaterThan(space.sequence);
  expect(result.hits).toHaveLength(1);
  for (const topK of [0, 0.5, 4097])
    await expect(f.backend.search({ space, vector: [1, 0, 0, 0], topK })).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
    });
});

it('rejects a malformed persisted Chunk header at the SQL result boundary', async () => {
  const f = await fixture();
  await f.create();
  await f.mutations.run('ingest', { memoryId: 'space', requestId: 'a', content: 'aligned' });
  const db = new DatabaseSync(f.path);
  try {
    db.exec("UPDATE rm_chunks SET chunk_json=json_remove(chunk_json,'$.ordinal')");
    await expect(f.search()).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
  } finally {
    db.close();
  }
});
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
