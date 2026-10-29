import { expect, it } from 'vitest';
import { createRetrievalContentBundle, replayRetrievalMutation } from '@ta-agent/retrieval-memory';
import { fixture } from './support/fixture.js';

it('browses, removes and recovers receipts with only the coherent Backend', async () => {
  const f = await fixture();
  await f.create();
  const entry = await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'add',
    content: 'aligned',
  });
  const entryId = entry.receipt.entryId!;
  const bundle = createRetrievalContentBundle({ backend: f.backend });
  expect(await bundle.workflows.inspect.run({ input: { memoryId: 'space' } })).toMatchObject({
    status: 'completed',
    value: { sequence: 1 },
  });
  expect(await bundle.workflows.list.run({ input: { memoryId: 'space' } })).toMatchObject({
    status: 'completed',
    value: { entries: [{ entryId }] },
  });
  expect(await bundle.workflows.get.run({ input: { memoryId: 'space', entryId } })).toMatchObject({
    status: 'completed',
    value: { content: 'aligned' },
  });
  const input = { memoryId: 'space', requestId: 'remove', entryId, expectedRevision: 1 };
  const removed = await bundle.workflows.remove.run({ input });
  expect(await bundle.workflows.remove.run({ input })).toEqual(removed);
  expect(await replayRetrievalMutation(f.backend, { operation: 'remove', input })).toEqual(
    removed.status === 'skipped' ? undefined : removed.receipt
  );
  await expect(
    bundle.workflows.remove.run({ input: { ...input, requestId: 'other' } })
  ).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND', commit: { status: 'not-committed' } });
  expect(
    await bundle.workflows.getReceipt.run({ input: { memoryId: 'space', requestId: 'remove' } })
  ).toMatchObject({ status: 'completed' });
});
