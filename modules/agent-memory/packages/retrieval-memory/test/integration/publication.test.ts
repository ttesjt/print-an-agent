import { expect, it } from 'vitest';
import { fixture } from '../support/fixture.js';
import { createRetrievalMutations } from '@print-an-agent/retrieval-memory';
it('rejects a stale prepared update without overwriting the winner', async () => {
  const f = fixture();
  await f.create();
  const signal = new AbortController().signal;
  const result = await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'a',
    content: 'old',
  });
  const base = { memoryId: 'space', entryId: result.receipt.entryId!, expectedRevision: 1 };
  const stale = await f.mutations.prepare(
    'update',
    { ...base, requestId: 'stale', content: 'stale' },
    signal
  );
  await f.mutations.run('update', { ...base, requestId: 'winner', content: 'winner' });
  await expect(f.mutations.publish(stale, signal)).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  });
  expect((await f.backend.get('space', base.entryId))?.entry.content).toBe('winner');
});
it('does not submit a cancelled candidate, but retains a receipt returned after commit', async () => {
  const f = fixture();
  await f.create();
  const abort = new AbortController();
  const prepared = await f.mutations.prepare(
    'ingest',
    { memoryId: 'space', requestId: 'a', content: 'text' },
    abort.signal
  );
  abort.abort();
  await expect(f.mutations.publish(prepared, abort.signal)).rejects.toMatchObject({
    code: 'OPERATION_ABORTED',
  });
  expect(f.entries.size).toBe(0);
  const late = new AbortController();
  const publish = f.backend.publish.bind(f.backend);
  f.backend.publish = async (...args) => {
    const receipt = await publish(...args);
    late.abort();
    return receipt;
  };
  expect(
    (
      await f.mutations.run(
        'ingest',
        { memoryId: 'space', requestId: 'b', content: 'text' },
        late.signal
      )
    ).status
  ).toBe('committed');
});
it('rejects invalid derived spans before embedding, and never closes borrowed resources', async () => {
  const f = fixture();
  await f.create();
  const chunker = f.resources.chunkers.resolve();
  const resources = {
    ...f.resources,
    chunkers: {
      resolve: () => ({
        ...chunker,
        chunk: () => Promise.resolve([{ text: 'not original', span: { start: 0, end: 1 } }]),
      }),
    },
  };
  await expect(
    createRetrievalMutations(resources).run('ingest', {
      memoryId: 'space',
      requestId: 'bad',
      content: 'x',
    })
  ).rejects.toMatchObject({ code: 'REPRESENTATION_INVALID' });
  expect(f.calls.embeddings).toBe(0);
  expect(f.entries.size).toBe(0);
});
it('checks configuration and every canonical vector again at publication', async () => {
  const f = fixture();
  await f.create();
  const signal = new AbortController().signal;
  const prepared = await f.mutations.prepare(
    'ingest',
    { memoryId: 'space', requestId: 'bad', content: 'text' },
    signal
  );
  if (!('publication' in prepared) || prepared.publication.representation === null)
    throw new Error('Expected representation');
  const p = prepared.publication;
  const representation = prepared.publication.representation;
  for (const vector of [
    [1e20, 0, 0, 0],
    [0, 0, 0, 0],
  ]) {
    const bad = {
      ...p,
      representation: {
        ...representation,
        chunks: representation.chunks.map((chunk) => ({ ...chunk, vector })),
      },
    };
    await expect(f.backend.publish(bad)).rejects.toMatchObject({ code: 'REPRESENTATION_INVALID' });
  }
  await expect(
    f.backend.publish({ ...p, space: { ...p.space, revision: 2 } })
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  expect(f.entries.size).toBe(0);
});
