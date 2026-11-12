import { expect, it } from 'vitest';
import { createRetrievalMutations, createRetrievalQueries } from '@print-an-agent/retrieval-memory';
import { fixture } from './support/fixture.js';
for (const kind of ['opaque', 'sqlite'] as const) {
  it(`${kind}: supplies the same write/read/filter/pagination contract through public ports`, async () => {
    const f = await fixture(kind);
    await f.create();
    await f.create('other');
    const a = await f.mutations.run('ingest', {
      memoryId: 'space',
      requestId: 'a',
      content: 'match',
      metadata: { allowed: false },
    });
    const b = await f.mutations.run('ingest', {
      memoryId: 'space',
      requestId: 'b',
      content: 'second',
      metadata: { allowed: true, nested: { 'a\0b': null } },
      source: { ref: 'source\0tail' },
    });
    await f.mutations.run('ingest', {
      memoryId: 'other',
      requestId: 'a',
      content: 'match',
      metadata: { allowed: true },
    });
    const result = await f.queries.search(
      {
        memoryId: 'space',
        query: 'match',
        topK: 1,
        filter: { op: 'eq', path: ['allowed'], value: true },
      },
      f.signal
    );
    expect(result.hits[0]?.entryId).toBe(b.receipt.entryId);
    expect(result.hits[0]?.source?.ref).toBe('source\0tail');
    const first = await f.queries.list({ memoryId: 'space', limit: 1 }, f.signal);
    const second = await f.queries.list(
      { memoryId: 'space', limit: 1, cursor: first.nextCursor },
      f.signal
    );
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.entryId)).size).toBe(
      2
    );
    expect(first.entries.every((entry) => !('content' in entry))).toBe(true);
    await f.mutations.run('remove', {
      memoryId: 'space',
      requestId: 'delete',
      entryId: a.receipt.entryId!,
      expectedRevision: 1,
    });
    expect(
      (await f.queries.search({ memoryId: 'space', query: 'match' }, f.signal)).hits
    ).toHaveLength(1);
    await expect(
      f.queries.list({ memoryId: 'space', limit: 1, cursor: first.nextCursor }, f.signal)
    ).rejects.toMatchObject({ code: 'STALE_CURSOR' });
  });
  it(`${kind}: arbitrates duplicate requests before stale revision and preserves canonical input identity`, async () => {
    const f = await fixture(kind);
    await f.create();
    const input = {
      memoryId: 'space',
      requestId: 'a',
      content: 'match',
      metadata: { first: 1, second: true },
    };
    const [a, b] = await Promise.all([
      f.mutations.run('ingest', input),
      f.mutations.run('ingest', { ...input, metadata: { second: true, first: 1 } }),
    ]);
    expect(a).toEqual(b);
    const update = {
      memoryId: 'space',
      requestId: 'edit',
      entryId: a.receipt.entryId!,
      expectedRevision: 1,
      content: 'updated',
    };
    const saved = await f.mutations.run('update', update);
    expect(await f.mutations.run('update', update)).toEqual(saved);
    await expect(f.mutations.run('update', { ...update, content: 'other' })).rejects.toMatchObject({
      code: 'REQUEST_CONFLICT',
    });
  });
  it(`${kind}: supports long scoped cursors without a hidden model/transport identifier bound`, async () => {
    const f = await fixture(kind);
    const mutations = createRetrievalMutations(f.ports, { maxIdBytes: null });
    const queries = createRetrievalQueries(f.ports, { maxIdBytes: null });
    const memoryId = 'space-' + '😀'.repeat(400);
    await mutations.run('create', { memoryId, requestId: 'create', index: f.index });
    for (const requestId of ['a', 'b'])
      await mutations.run('ingest', { memoryId, requestId, content: 'match' });
    const first = await queries.list({ memoryId, limit: 1 }, f.signal);
    expect(first.nextCursor!.length).toBeGreaterThan(256);
    expect(
      (await queries.list({ memoryId, limit: 1, cursor: first.nextCursor }, f.signal)).entries
    ).toHaveLength(1);
    await expect(
      queries.list({ memoryId: 'space', limit: 1, cursor: first.nextCursor }, f.signal)
    ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
  });
}
