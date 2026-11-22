import { expect, it } from 'vitest';
import {
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  createRetrievalReindexDefinition,
  findRetrievalCommit,
} from '@print-an-agent/retrieval-memory';
import { fixture } from '../../../support/fixture.js';
it('rebuilds one representation, preserves Entry revision and replays without rebuilding again', async () => {
  const f = await fixture();
  await f.create();
  const { receipt } = await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'a',
    content: 'aligned',
  });
  const entryId = receipt.entryId!;
  const before = await f.backend.get('space', entryId);
  const w = createRetrievalMemoryBundle({
    resources: createRetrievalWorkflowResources(f.resources),
  }).workflows;
  const input = { memoryId: 'space', requestId: 'rebuild', entryId, expectedRevision: 1 };
  const result = await w.reindex.run({ input });
  const after = await f.backend.get('space', entryId);
  expect(after?.entry).toEqual(before?.entry);
  expect(after?.representation.representationId).not.toBe(before?.representation.representationId);
  expect(after?.representation.chunks[0]?.chunkId).not.toBe(
    before?.representation.chunks[0]?.chunkId
  );
  expect((await f.backend.inspect('space'))?.sequence).toBe(2);
  expect((await f.search()).hits[0]?.representationId).toBe(after?.representation.representationId);
  expect(await w.reindex.run({ input })).toEqual(result);
  expect((await f.backend.inspect('space'))?.sequence).toBe(2);
});
it.each(['update', 'remove', 'reindex'] as const)(
  'rejects a stale rebuild after concurrent %s',
  async (operation) => {
    const f = await fixture();
    await f.create();
    const { receipt } = await f.mutations.run('ingest', {
      memoryId: 'space',
      requestId: 'a',
      content: 'aligned',
    });
    const input = {
      memoryId: 'space',
      entryId: receipt.entryId!,
      expectedRevision: 1,
      requestId: 'stale',
    };
    const signal = new AbortController().signal;
    const stale = await f.mutations.prepare('reindex', input, signal);
    await f.mutations.run(operation, {
      ...input,
      requestId: 'winner',
      ...(operation === 'update' ? { content: 'angled new' } : {}),
    });
    await expect(f.mutations.publish(stale, signal)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    expect((await f.backend.inspect('space'))?.sequence).toBe(2);
  }
);
it('preserves the old representation on cancellation and rejects unsupported target parameters', async () => {
  const f = await fixture();
  await f.create();
  const { receipt } = await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'a',
    content: 'aligned',
  });
  const input = {
    memoryId: 'space',
    entryId: receipt.entryId!,
    expectedRevision: 1,
    requestId: 'rebuild',
  };
  const before = await f.backend.get('space', input.entryId);
  const abort = new AbortController();
  const candidate = await f.mutations.prepare('reindex', input, abort.signal);
  abort.abort();
  await expect(f.mutations.publish(candidate, abort.signal)).rejects.toMatchObject({
    code: 'OPERATION_ABORTED',
  });
  expect(await f.backend.get('space', input.entryId)).toEqual(before);
  await expect(
    f.mutations.run('reindex', { ...input, target: 'another-model' })
  ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
});
it('preserves rebuild facts across executor failure and can recover from its receipt', async () => {
  const f = await fixture();
  await f.create();
  const { receipt } = await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'a',
    content: 'aligned',
  });
  const resources = createRetrievalWorkflowResources(f.resources);
  const definition = createRetrievalReindexDefinition({
    executeStep: async (execution) => {
      await execution.step(execution.context);
      if (execution.stepName === 'publish') throw new Error('cleanup failed');
    },
  });
  const w = createRetrievalMemoryBundle({
    resources,
    workflows: { reindex: definition },
  }).workflows;
  const error = await w.reindex
    .run({
      input: {
        memoryId: 'space',
        entryId: receipt.entryId!,
        expectedRevision: 1,
        requestId: 'rebuild',
      },
    })
    .catch((cause: unknown) => cause);
  expect(findRetrievalCommit(error)).toMatchObject({
    status: 'committed',
    receipt: { operation: 'reindex', sequence: 2 },
  });
  expect((await f.backend.getReceipt('space', 'rebuild'))?.sequence).toBe(2);
});
