import { expect, it } from 'vitest';
import { createRetrievalMutations } from '@print-an-agent/retrieval-memory';
import { fixture } from './support/fixture.js';
it('publishes and reopens authority, vectors and receipts together', async () => {
  const f = await fixture();
  await f.create();
  const result = await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'add',
    content: 'aligned record',
    metadata: { tag: 'first' },
    source: { ref: 'test:source' },
  });
  expect((await f.search()).hits[0]).toMatchObject({
    text: 'aligned record',
    source: { ref: 'test:source' },
    entryId: result.receipt.entryId,
  });
  await f.backend.close();
  const reopened = await f.connect();
  expect(await reopened.getReceipt('space', 'add')).toEqual(result.receipt);
  expect((await reopened.get('space', result.receipt.entryId!))?.entry.content).toBe(
    'aligned record'
  );
  expect(
    (
      await reopened.search({
        space: (await reopened.inspect('space'))!,
        vector: [1, 0, 0, 0],
        topK: 1,
      })
    ).hits
  ).toHaveLength(1);
});
it('removes stale chunks on update and all visibility on delete', async () => {
  const f = await fixture();
  await f.create();
  const { receipt } = await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'add',
    content: 'aligned old',
  });
  const identity = { memoryId: 'space', entryId: receipt.entryId!, expectedRevision: 1 };
  await f.mutations.run('update', { ...identity, requestId: 'edit', content: 'angled new' });
  expect((await f.search()).hits.map((hit) => hit.text)).toEqual(['angled new']);
  await f.mutations.run('remove', { ...identity, expectedRevision: 2, requestId: 'remove' });
  expect((await f.search()).hits).toEqual([]);
  expect(await f.backend.get('space', identity.entryId)).toBeUndefined();
});
it('preserves legal NUL, supplementary and non-normalized content, metadata and source', async () => {
  const f = await fixture();
  const memoryId = 'space-😀e\u0301';
  await f.create(memoryId);
  const content = 'aligned\0tail 😀e\u0301';
  const { receipt } = await f.mutations.run('ingest', {
    memoryId,
    requestId: 'request-😀',
    content,
    metadata: { 'a\0b': 'x\0y' },
    source: { ref: 'source\0tail', label: 'label\0tail' },
  });
  expect((await f.backend.get(memoryId, receipt.entryId!))?.entry).toMatchObject({
    content,
    source: { ref: 'source\0tail', label: 'label\0tail' },
  });
  expect(
    (await f.search(memoryId, { filter: { op: 'eq', path: ['a\0b'], value: 'x\0y' } })).hits[0]
      ?.text
  ).toBe(content);
  for (const bad of ['space-\ud800', 'space-\ud801'])
    await expect(f.backend.inspect(bad)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
});
it('resolves same-request races and rejects concurrent stale revision across independent workers', async () => {
  const f = await fixture();
  await f.create();
  const peer = createRetrievalMutations({ ...f.resources, backend: await f.connect() });
  const input = { memoryId: 'space', requestId: 'add', content: 'aligned' };
  const [a, b] = await Promise.all([f.mutations.run('ingest', input), peer.run('ingest', input)]);
  expect(a).toEqual(b);
  expect((await f.search()).hits).toHaveLength(1);
  const identity = { memoryId: 'space', entryId: a.receipt.entryId!, expectedRevision: 1 };
  const results = await Promise.allSettled([
    f.mutations.run('update', { ...identity, requestId: 'a', content: 'A' }),
    peer.run('update', { ...identity, requestId: 'b', content: 'B' }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected).toMatchObject({
    reason: { code: 'REVISION_CONFLICT', commit: { status: 'not-committed' } },
  });
});
