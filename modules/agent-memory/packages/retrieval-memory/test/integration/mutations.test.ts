import { expect, it } from 'vitest';
import { fixture } from '../support/fixture.js';
import { createRetrievalMutations, RetrievalMemoryError } from '@print-an-agent/retrieval-memory';
it('creates, ingests, replaces, performs no-op, removes and replays original facts', async () => {
  const f = fixture();
  await f.create();
  const input = {
    memoryId: 'space',
    requestId: 'add',
    content: 'hello 😀 world',
    metadata: { tag: true },
  };
  const first = await f.mutations.run('ingest', input);
  const entryId = first.receipt.entryId!;
  expect(first.receipt.sequence).toBe(1);
  const old = await f.backend.get('space', entryId);
  expect(old?.representation.chunks[0]?.vector).toEqual([1, 0, 0, 0]);
  const update = { ...input, requestId: 'same', entryId, expectedRevision: 1 };
  const count = f.calls.embeddings;
  expect((await f.mutations.run('update', update)).status).toBe('unchanged');
  expect(f.calls.embeddings).toBe(count);
  await f.mutations.run('update', { ...update, requestId: 'new', content: 'different' });
  expect((await f.backend.get('space', entryId))?.entry).toMatchObject({
    content: 'different',
    metadata: { tag: true },
    revision: 2,
  });
  await expect(f.mutations.run('update', { ...update, requestId: 'stale' })).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
    commit: { status: 'not-committed' },
  });
  await f.mutations.run('remove', {
    memoryId: 'space',
    requestId: 'remove',
    entryId,
    expectedRevision: 2,
  });
  expect(await f.backend.get('space', entryId)).toBeUndefined();
  expect(await f.mutations.run('ingest', input)).toEqual(first);
  await expect(f.mutations.run('ingest', { ...input, content: 'changed' })).rejects.toMatchObject({
    code: 'REQUEST_CONFLICT',
  });
});
it('arbitrates identical concurrent requests before CAS and generates only one durable Entry', async () => {
  const f = fixture();
  await f.create();
  const input = { memoryId: 'space', requestId: 'race', content: 'same' };
  const [a, b] = await Promise.all([
    f.mutations.run('ingest', input),
    f.mutations.run('ingest', input),
  ]);
  expect(a).toEqual(b);
  expect(f.entries.size).toBe(1);
  expect(f.spaces.get('space')?.sequence).toBe(1);
});
it('recovers a receipt when a preflight read observes the revision after an identical request committed', async () => {
  const f = fixture();
  await f.create();
  const { receipt } = await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'add',
    content: 'old',
  });
  const input = {
    memoryId: 'space',
    requestId: 'edit',
    entryId: receipt.entryId!,
    expectedRevision: 1,
    content: 'new',
  };
  const original = f.backend.getReceipt.bind(f.backend);
  let intercepted = false;
  f.backend.getReceipt = async (memoryId, requestId, signal) => {
    if (requestId === 'edit' && !intercepted) {
      intercepted = true;
      await f.mutations.run('update', input);
      return undefined;
    }
    return original(memoryId, requestId, signal);
  };
  const result = await f.mutations.run('update', input);
  expect(result.receipt.entryRevision).toBe(2);
  expect(f.spaces.get('space')?.sequence).toBe(2);
});
it('retains a durable receipt delivered together with cancellation', async () => {
  const f = fixture();
  const first = await f.create();
  const controller = new AbortController();
  const get = f.backend.getReceipt.bind(f.backend);
  f.backend.getReceipt = async (...args) => {
    const receipt = await get(...args);
    controller.abort();
    return receipt;
  };
  const result = await f.create().catch(() => undefined);
  expect(result).toEqual(first);
  const request = { memoryId: 'space', requestId: 'create', index: f.spaces.get('space')!.index };
  // Use the original exact business shape; persisted index has system fields that are not input.
  const { embeddingRef, chunkerRef, metricRef } = request.index;
  const fresh = new AbortController();
  f.backend.getReceipt = async (...args) => {
    const receipt = await get(...args);
    fresh.abort();
    return receipt;
  };
  expect(
    await f.mutations.run(
      'create',
      { ...request, index: { embeddingRef, chunkerRef, metricRef } },
      fresh.signal
    )
  ).toEqual(first);
});
it('reports an unknown publication result and recovers without inserting twice', async () => {
  const f = fixture();
  await f.create();
  const publish = f.backend.publish.bind(f.backend);
  let drop = true;
  f.backend.publish = async (...args) => {
    const receipt = await publish(...args);
    if (drop) {
      drop = false;
      throw new Error('lost reply');
    }
    return receipt;
  };
  const input = { memoryId: 'space', requestId: 'lost', content: 'durable' };
  await expect(f.mutations.run('ingest', input)).rejects.toMatchObject({
    code: 'COMMIT_UNKNOWN',
    commit: { status: 'unknown' },
  });
  expect((await f.mutations.run('ingest', input)).receipt.sequence).toBe(1);
  expect(f.entries.size).toBe(1);
});
it('rejects corrupted candidates even when callers bypass preparation', async () => {
  const f = fixture();
  await f.create();
  const signal = new AbortController().signal;
  const prepared = await f.mutations.prepare(
    'ingest',
    { memoryId: 'space', requestId: 'a', content: 'text' },
    signal
  );
  if (!('publication' in prepared)) throw new Error('Expected candidate');
  const invalid = structuredClone(prepared.publication);
  if (invalid.representation === null) throw new Error('Expected representation');
  const corrupt = {
    ...invalid,
    representation: { ...invalid.representation, embeddingRef: 'another-model' },
  };
  await expect(f.backend.publish(corrupt)).rejects.toBeInstanceOf(RetrievalMemoryError);
  expect(f.entries.size).toBe(0);
  await expect(
    createRetrievalMutations(f.resources).publish(
      { publication: { ...invalid, space: { ...invalid.space, memoryId: 'other' } } },
      signal
    )
  ).rejects.toMatchObject({ code: 'REPRESENTATION_INVALID' });
});

it('rejects invalid source spans in both domain and backend publication paths', async () => {
  const f = fixture();
  await f.create();
  const signal = new AbortController().signal;
  const prepared = await f.mutations.prepare(
    'ingest',
    { memoryId: 'space', requestId: 'invalid-span', content: 'source text' },
    signal
  );
  if (!('publication' in prepared) || prepared.publication.representation === null)
    throw new Error('Expected prepared representation');
  const candidate = {
    ...prepared.publication,
    representation: {
      ...prepared.publication.representation,
      chunks: prepared.publication.representation.chunks.map((chunk) => ({
        ...chunk,
        span: { start: 0, end: 1 },
      })),
    },
  };
  await expect(f.mutations.publish({ publication: candidate }, signal)).rejects.toMatchObject({
    code: 'REPRESENTATION_INVALID',
  });
  await expect(f.backend.publish(candidate, signal)).rejects.toMatchObject({
    code: 'REPRESENTATION_INVALID',
  });
  expect(f.entries.size).toBe(0);
  expect(await f.backend.getReceipt('space', 'invalid-span', signal)).toBeUndefined();
});
